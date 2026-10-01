// T1: tenant isolation through the tool's normal API, as skal_app.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, withTenant } from '../src/db.ts';
import * as s from '../src/schema/m3.ts';
import { pgError, seedTenant, uuid, type SeededTenant } from './helpers.ts';

const db = connect('drizzle_app', 'app');
let A: SeededTenant;
let B: SeededTenant;

beforeAll(async () => {
  A = await seedTenant(db, 't1-A');
  B = await seedTenant(db, 't1-B');
});
afterAll(() => db.$client.end());

// Each tenant table and its tenant column.
const tables = [
  ['tenant', s.tenant, s.tenant.id],
  ['campaign', s.campaign, s.campaign.tenantId],
  ['field_definition', s.fieldDefinition, s.fieldDefinition.tenantId],
  ['entity', s.entity, s.entity.tenantId],
  ['claim_version', s.claimVersion, s.claimVersion.tenantId],
  ['claim_current', s.claimCurrent, s.claimCurrent.tenantId],
  ['claim_embedding', s.claimEmbedding, s.claimEmbedding.tenantId],
  ['transcript_segment', s.transcriptSegment, s.transcriptSegment.tenantId],
  ['import_record', s.importRecord, s.importRecord.tenantId],
] as const;

describe('T1 tenant isolation', () => {
  test('T1 reads: tenant A sees none of B and all of its own rows, in every tenant table', async () => {
    await withTenant(db, A.tenant, async (tx) => {
      for (const [name, table, col] of tables) {
        expect(await tx.$count(table, eq(col, B.tenant)), `${name}: B rows visible to A`).toBe(0);
        expect(await tx.$count(table), `${name}: rows visible to A`).toBe(await tx.$count(table, eq(col, A.tenant)));
        expect(await tx.$count(table, eq(col, A.tenant)), `${name}: A rows`).toBeGreaterThan(0);
      }
    });
  });

  test('T1 updates and deletes of B rows affect nothing', async () => {
    await withTenant(db, A.tenant, async (tx) => {
      const u1 = await tx.update(s.entity).set({ displayName: 'hijacked' }).where(eq(s.entity.id, B.entity)).returning();
      const u2 = await tx.update(s.campaign).set({ name: 'hijacked' }).where(eq(s.campaign.tenantId, B.tenant)).returning();
      const u3 = await tx.update(s.tenant).set({ name: 'hijacked' }).where(eq(s.tenant.id, B.tenant)).returning();
      const u4 = await tx
        .update(s.claimCurrent)
        .set({ object: 'hijacked' })
        .where(eq(s.claimCurrent.tenantId, B.tenant))
        .returning();
      // claim_version is append-only by trigger, but RLS filters B's rows first, so the trigger never fires.
      const u5 = await tx.update(s.claimVersion).set({ predicate: 'x' }).where(eq(s.claimVersion.tenantId, B.tenant)).returning();
      expect([u1, u2, u3, u4, u5].map((r) => r.length)).toEqual([0, 0, 0, 0, 0]);

      const d1 = await tx.delete(s.importRecord).where(eq(s.importRecord.tenantId, B.tenant)).returning();
      const d2 = await tx.delete(s.claimEmbedding).where(eq(s.claimEmbedding.tenantId, B.tenant)).returning();
      const d3 = await tx.delete(s.transcriptSegment).where(eq(s.transcriptSegment.tenantId, B.tenant)).returning();
      const d4 = await tx.delete(s.fieldDefinition).where(eq(s.fieldDefinition.tenantId, B.tenant)).returning();
      expect([d1, d2, d3, d4].map((r) => r.length)).toEqual([0, 0, 0, 0]);
    });

    // B's rows are untouched.
    await withTenant(db, B.tenant, async (tx) => {
      const [e] = await tx.select().from(s.entity).where(eq(s.entity.id, B.entity));
      expect(e?.displayName).toBe('t1-B npc');
      for (const [name, table, col] of tables) {
        expect(await tx.$count(table, eq(col, B.tenant)), `${name}: B rows after A's attempts`).toBeGreaterThan(0);
      }
    });
  });

  test('T1 skal_app cannot reach claim_version partitions directly (RLS covers only the parent)', async () => {
    for (const p of ['claim_version_p0', 'claim_version_p1', 'claim_version_p2', 'claim_version_p3']) {
      const err = await pgError(withTenant(db, A.tenant, (tx) => tx.execute(sql`select count(*) from ${sql.identifier(p)}`)));
      expect(err.code, p).toBe('42501');
      expect(err.message).toMatch(/permission denied/);
    }
  });

  test('T1 inserting a row whose tenant_id is B is rejected by the policy', async () => {
    const e1 = await pgError(
      withTenant(db, A.tenant, (tx) =>
        tx.insert(s.campaign).values({ tenantId: B.tenant, id: uuid(), name: 'smuggled' }),
      ),
    );
    expect(e1.code).toBe('42501');
    expect(e1.message).toMatch(/row-level security/);
    const e2 = await pgError(
      withTenant(db, A.tenant, (tx) => tx.insert(s.tenant).values({ id: uuid(), name: 'another tenant' })),
    );
    expect(e2.message).toMatch(/row-level security/);
  });

  test("T1 an A row that references B's campaign is rejected by the composite foreign key", async () => {
    const err = await pgError(
      withTenant(db, A.tenant, (tx) =>
        tx.insert(s.entity).values({ tenantId: A.tenant, campaignId: B.campaign, kind: 'npc', displayName: 'cross' }),
      ),
    );
    expect(err.code).toBe('23503');
    expect(err.constraint).toBe('entity_tenant_id_campaign_id_fkey');

    // And A cannot learn that B's campaign exists by reading it.
    await withTenant(db, A.tenant, async (tx) => {
      expect(
        await tx.$count(s.campaign, and(eq(s.campaign.tenantId, B.tenant), eq(s.campaign.id, B.campaign))),
      ).toBe(0);
    });
  });
});
