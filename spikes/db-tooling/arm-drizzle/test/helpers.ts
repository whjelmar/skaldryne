import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { url, withTenant } from '../src/db.ts';
import * as s from '../src/schema/m3.ts';

export const ARM_DIR = resolve(import.meta.dirname, '..');
export const OUT_DIR = resolve(ARM_DIR, 'out');

/** Save command output that RESULTS.md quotes. */
export function saveOutput(name: string, text: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, name), text);
}

export interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

/** Await a promise that must fail and return the Postgres error (drizzle wraps it as `cause`). */
export async function pgError(p: Promise<unknown>): Promise<PgError> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: PgError };
    return err.cause ?? err;
  }
  throw new Error('expected the operation to fail, but it succeeded');
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function randomVector(dim = 768): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

export interface SeededTenant {
  tenant: string;
  campaign: string;
  entity: string;
  claim: string;
}

/** One row in every tenant table, written through the tool's normal API inside withTenant. */
export async function seedTenant(db: NodePgDatabase, label: string): Promise<SeededTenant> {
  const ids: SeededTenant = { tenant: uuid(), campaign: uuid(), entity: uuid(), claim: uuid() };
  await withTenant(db, ids.tenant, async (tx) => {
    await tx.insert(s.tenant).values({ id: ids.tenant, name: label });
    await tx.insert(s.campaign).values({ tenantId: ids.tenant, id: ids.campaign, name: `${label} campaign` });
    await tx.insert(s.fieldDefinition).values({ tenantId: ids.tenant, campaignId: ids.campaign, key: 'title', valueType: 'text' });
    await tx.insert(s.entity).values({
      tenantId: ids.tenant,
      id: ids.entity,
      campaignId: ids.campaign,
      kind: 'npc',
      displayName: `${label} npc`,
    });
    await tx.insert(s.claimVersion).values({
      tenantId: ids.tenant,
      claimId: ids.claim,
      version: 1,
      campaignId: ids.campaign,
      subjectId: ids.entity,
      predicate: 'title',
      object: `${label} title`,
    });
    await tx.insert(s.claimEmbedding).values({ tenantId: ids.tenant, claimId: ids.claim, embedding: randomVector() });
    await tx.insert(s.transcriptSegment).values({
      tenantId: ids.tenant,
      campaignId: ids.campaign,
      sessionNo: 1,
      startMs: 0,
      endMs: 1000,
      speaker: 'gm',
      text: `${label} says hello`,
      wordTimings: Buffer.from([1, 2, 3]),
    });
    await tx.insert(s.importRecord).values({
      tenantId: ids.tenant,
      source: 'seed',
      sourceKey: label,
      entityId: ids.entity,
      contentHash: 'h',
    });
  });
  return ids;
}

/**
 * A hash of everything a migration could change: relations, columns, constraints, indexes, triggers, functions,
 * policies, partitions, RLS flags, plus the migrator's bookkeeping rows. Read as skal_migrator.
 */
export async function fingerprint(database: string): Promise<string> {
  const text = (await catalog(database)).join('\n');
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
}

/** The catalog lines behind fingerprint(), sorted; migrator rows only where the migrations table exists. */
export async function catalog(database: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url(database, 'migrator') });
  await client.connect();
  try {
    const hasMigrations = (await client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`)).rows[0].t;
    const { rows } = await client.query<{ x: string }>(`
      select x from (
        select format('rel %s %s rls=%s part=%s', c.relname, c.relkind, c.relrowsecurity,
                      pg_get_expr(c.relpartbound, c.oid))
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'drizzle')
        union all
        select format('acl %s %s', c.relname, c.relacl::text)
          from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        union all
        select format('col %s.%s %s notnull=%s default=%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                      a.attnotnull, pg_get_expr(d.adbin, d.adrelid))
          from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
        union all
        select format('con %s %s', conname, pg_get_constraintdef(oid)) from pg_constraint
          where connamespace = 'public'::regnamespace
        union all
        select format('idx %s', pg_get_indexdef(indexrelid)) from pg_index i join pg_class c on c.oid = i.indrelid
          where c.relnamespace = 'public'::regnamespace
        union all
        select format('trg %s', pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal
        union all
        select format('fn %s', pg_get_functiondef(p.oid)) from pg_proc p where pronamespace = 'public'::regnamespace and prokind in ('f', 'p')
        union all
        select format('pol %s %s %s %s', polname, polrelid::regclass, pg_get_expr(polqual, polrelid),
                      pg_get_expr(polwithcheck, polrelid)) from pg_policy
        ${hasMigrations ? `union all select format('mig %s %s %s', id, name, hash) from drizzle.__drizzle_migrations` : ''}
      ) t(x) order by x`);
    return rows.map((r) => r.x);
  } finally {
    await client.end();
  }
}

/** Run drizzle-kit from the arm directory. pnpm exec is avoided because it cannot run from a network share here. */
export function drizzleKit(args: string[], env: Record<string, string> = {}): { code: number; output: string } {
  const r = spawnSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', ...args], {
    cwd: ARM_DIR,
    env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, output: `${r.stdout}${r.stderr}` };
}
