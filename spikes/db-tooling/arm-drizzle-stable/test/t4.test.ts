// T4: after M1-M3, drizzle-kit proposes no changes, and the trigger-maintained claim_current still works and is typed.
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'vitest';
import { connect, url, withTenant } from '../src/db.ts';
import * as s from '../src/schema/m3.ts';
import { catalog, drizzleKit, saveOutput, seedTenant, type SeededTenant } from './helpers.ts';

const db = connect('drizzle045_app', 'app');
let A: SeededTenant;
beforeAll(async () => {
  A = await seedTenant(db, 't4-A');
});
afterAll(() => db.$client.end());

describe('T4 triggers and partitions survive the tool', () => {
  test('T4 drizzle-kit generate (offline diff against the last snapshot) finds nothing', () => {
    const r = drizzleKit(['generate']);
    saveOutput('t4-generate.txt', r.output);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/No schema changes, nothing to migrate/);
  });

  test('T4 drizzle-kit check finds no snapshot conflicts', () => {
    const r = drizzleKit(['check']);
    saveOutput('t4-check.txt', r.output);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/Everything's fine/);
  });

  test('T4 (focus) generate/check never read the live database, so the partition tablesFilter is irrelevant to them', () => {
    // push/pull (the only commands that introspect) are out of scope for this arm. generate diffs schema vs the last snapshot,
    // so partitions, triggers, functions and policies cannot be proposed for dropping: it never sees them.
    const r = drizzleKit(['generate'], { RAW_INTROSPECTION: '1', DATABASE_URL: 'postgres://nobody:nope@127.0.0.1:1/none' });
    saveOutput('t4-generate-no-db-no-filter.txt', r.output);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/No schema changes, nothing to migrate/);
  });

  test('T4 the objects drizzle-kit does not model are all still present', async () => {
    const client = new pg.Client({ connectionString: url('drizzle045_app', 'migrator') });
    await client.connect();
    try {
      const q = async (text: string) => (await client.query<{ n: string }>(text)).rows.map((r) => r.n).sort();
      expect(await q(`select tgname as n from pg_trigger where not tgisinternal and tgrelid = 'claim_version'::regclass`))
        .toEqual(['claim_current_sync', 'claim_version_append_only']);
      expect(await q(`select proname as n from pg_proc where pronamespace = 'public'::regnamespace and prorettype = 'trigger'::regtype`))
        .toEqual(['claim_current_sync', 'claim_version_append_only']);
      expect(await q(`select inhrelid::regclass::text as n from pg_inherits where inhparent = 'claim_version'::regclass`))
        .toEqual(['claim_version_p0', 'claim_version_p1', 'claim_version_p2', 'claim_version_p3']);
      expect(await q(`select indexdef as n from pg_indexes where indexname = 'claim_embedding_hnsw'`)).toEqual([
        'CREATE INDEX claim_embedding_hnsw ON public.claim_embedding USING hnsw (embedding halfvec_cosine_ops) WITH (m=\'16\', ef_construction=\'64\')',
      ]);
      expect((await q(`select polrelid::regclass::text as n from pg_policy where polname = 'tenant_isolation'`)).length).toBe(9);
    } finally {
      await client.end();
    }
  });

  test('T4 (fidelity) the migrated catalog equals reference/schema.sql, apart from the M2/M3 entity change', async () => {
    const strip = (lines: string[]) =>
      lines.filter((l) => !/__drizzle_migrations|^mig |entity\.(name|display_name) |entity_(name|display_name)_not_null |entity_name_sync/.test(l));
    const ours = strip(await catalog('drizzle045_app'));
    const reference = strip(await catalog('drizzle045_reference'));
    const missing = reference.filter((l) => !ours.includes(l));
    const extra = ours.filter((l) => !reference.includes(l));
    saveOutput('t4-catalog-diff.txt', `missing vs reference:\n${missing.join('\n')}\n\nextra vs reference:\n${extra.join('\n')}\n`);
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  test('T4 inserting claim versions through the tool updates claim_current, and claim_current reads are typed', async () => {
    const current = await withTenant(db, A.tenant, async (tx) => {
      await tx.insert(s.claimVersion).values({
        tenantId: A.tenant,
        claimId: A.claim,
        version: 2,
        campaignId: A.campaign,
        subjectId: A.entity,
        predicate: 'title',
        object: 'mayor',
      });
      return tx
        .select()
        .from(s.claimCurrent)
        .where(and(eq(s.claimCurrent.tenantId, A.tenant), eq(s.claimCurrent.claimId, A.claim)));
    });
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ version: 2, object: 'mayor', predicate: 'title', subjectId: A.entity });

    type Current = (typeof current)[number];
    expectTypeOf<Current>().toEqualTypeOf<{
      tenantId: string;
      claimId: string;
      version: number;
      campaignId: string;
      subjectId: string;
      predicate: string;
      object: unknown;
    }>();

    // The append-only trigger still fires for the tenant's own rows.
    await expect(
      withTenant(db, A.tenant, (tx) =>
        tx.update(s.claimVersion).set({ predicate: 'x' }).where(eq(s.claimVersion.claimId, A.claim)),
      ),
    ).rejects.toThrow();
  });
});
