// Experiment 1: the four hard queries (Q1 graph hops, Q2 full-text, Q3 hybrid RRF, Q4 SKIP LOCKED queue) plus the RLS check.
// Runs against exp1_drizzle, recreated from the exp1_main template; connects as skal_app.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'vitest';
import { url, withTenant } from '../src/db.ts';
import { connectExp1, exp1 } from '../src/exp1.ts';
import { claimCurrent } from '../src/schema/m4.ts';
import { ARM_DIR, saveOutput } from './helpers.ts';

const TENANT_A = '00000000-0000-7000-8000-00000000000a';
const E3 = '0000000a-0001-7000-8000-000000000003';
const A1 = '0000000a-0000-7000-8000-000000000001';
const A2 = '0000000a-0000-7000-8000-000000000002';
const QV = Array.from({ length: 768 }, (_, i) => Math.sin(4.5 * 0.37 + i * 0.05));
const LOG = join(ARM_DIR, 'exp1-sql.log');

let label = '-';
const captured = new Map<string, { query: string; params: unknown[] }[]>();
const db = connectExp1('exp1_drizzle', (query, params) => {
  const short = params.map((p) => (typeof p === 'string' && p.length > 80 ? `${p.slice(0, 40)}...(${p.length} chars)` : p));
  appendFileSync(LOG, `-- [${label}]\n${query}\n-- params: ${JSON.stringify(short)}\n\n`);
  if (/^(begin|commit|rollback)\b/i.test(query) || /set_config/.test(query)) return;
  if (!captured.has(label)) captured.set(label, []);
  captured.get(label)!.push({ query, params });
});
const run = <T>(name: string, tenant: string | null, fn: (q: ReturnType<typeof exp1>) => Promise<T>) =>
  withTenant(db, tenant, (tx) => {
    label = name;
    return fn(exp1(tx, TENANT_A));
  });

async function admin(text: string): Promise<pg.QueryResult> {
  const c = new pg.Client({ connectionString: url('postgres', 'postgres') });
  await c.connect();
  try {
    return await c.query(text);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  writeFileSync(LOG, '');
  for (let attempt = 0; ; attempt++) {
    try {
      await admin('DROP DATABASE IF EXISTS exp1_drizzle WITH (FORCE)');
      await admin('CREATE DATABASE exp1_drizzle TEMPLATE exp1_main OWNER skal_migrator');
      break;
    } catch (err) {
      if (attempt >= 10 || !/being accessed by other users/.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
});
afterAll(() => db.$client.end());

const ord = (id: string) => Number(id.slice(-3));
const ent = (id: string) => `e${id.slice(-1)}`;

describe('Q1 graph hops', () => {
  test('Q1 from e3: six entities, shortest depth and path, ordered by depth then name', async () => {
    const rows = await run('Q1 graphHops', TENANT_A, (q) => q.graphHops(E3));
    expectTypeOf(rows).toEqualTypeOf<{ entityId: string; displayName: string; depth: number; path: string[] }[]>();
    expect(rows.map((r) => [r.displayName, r.depth, r.path.map(ent).join(',')])).toEqual([
      ['Brother Calder', 1, 'e3,e2'],
      ['Duke Orsolo', 1, 'e3,e4'],
      ['Archivist Mira', 2, 'e3,e2,e1'],
      ['Envoy Tamsin', 2, 'e3,e4,e5'],
      ['Ferryman Gaunt', 2, 'e3,e2,e6'],
      ['Grey Abbess', 3, 'e3,e2,e6,e7'],
    ]);
    expect(rows.map((r) => ent(r.entityId))).toEqual(['e2', 'e4', 'e1', 'e5', 'e6', 'e7']);
  });
});

describe('Q2 full-text search', () => {
  test('Q2 A1 english "cult or leader"', async () => {
    const rows = await run('Q2 searchSegments', TENANT_A, (q) => q.searchSegments(A1, 'english', 'cult or leader'));
    expectTypeOf(rows).toEqualTypeOf<{ id: string; sessionNo: number; startMs: number; rank: number; headline: string }[]>();
    expect(rows.map((r) => [ord(r.id), r.sessionNo, r.startMs, r.rank, r.headline])).toEqual([
      [1, 1, 0, 0.2, 'The <b>cult</b> <b>leader</b> spoke from the ashen altar while the crowd chanted.'],
      [2, 1, 10000, 0.1, 'Mira found a letter from the <b>cult</b> hidden in the archive.'],
      [3, 1, 20000, 0.1, 'Brother Calder denied any link to the <b>leader</b> of the Ashen Eye.'],
      [5, 1, 40000, 0.1, '<b>Leaders</b> of the guilds met to discuss the missing grain.'],
      [7, 2, 0, 0.1, 'A <b>cult</b> symbol was carved into the hull of the ferry.'],
      [9, 2, 20000, 0.1, 'Nobody mentioned the <b>cult</b> again until the final session.'],
      [11, 2, 40000, 0.1, 'Cultists followed their <b>leader</b> into the catacombs beneath the abbey.'],
    ]);
  });

  test('Q2 A2 german "Kult"', async () => {
    const rows = await run('Q2 searchSegments (german)', TENANT_A, (q) => q.searchSegments(A2, 'german', 'Kult'));
    expect(rows.map((r) => [ord(r.id), r.sessionNo, r.startMs, r.rank, r.headline])).toEqual([
      [101, 1, 0, 0.1, 'Der <b>Kult</b> versammelte sich im Wald.'],
      [102, 1, 10000, 0.1, 'Die Anführerin des <b>Kultes</b> sprach leise.'],
    ]);
  });
});

describe('Q3 hybrid search', () => {
  test('Q3 A1 english "cult or leader" with the query vector', async () => {
    const rows = await run('Q3 hybridSearch', TENANT_A, (q) => q.hybridSearch(A1, 'english', 'cult or leader', QV));
    // Finding: the rank columns can be null at runtime (full join) but drizzle infers plain number; the expected value below stays unchanged.
    expectTypeOf(rows).toEqualTypeOf<{ id: string; ftsRank: number; vecRank: number; score: number }[]>();
    expect(rows.map((r) => [ord(r.id), r.ftsRank, r.vecRank, r.score])).toEqual([
      [5, 4, 2, 0.031754],
      [3, 3, 3, 0.031746],
      [2, 2, 5, 0.031514],
      [1, 1, 7, 0.031319],
      [7, 5, 6, 0.030536],
      [9, 6, 9, 0.029644],
      [4, null, 1, 0.016393],
      [6, null, 4, 0.015625],
      [11, 7, null, 0.014925],
      [8, null, 8, 0.014706],
    ]);
  });
});

describe('RLS check', () => {
  test('Q1-Q3 and claim_current return zero rows with no tenant set', async () => {
    expect(await run('RLS Q1', '', (q) => q.graphHops(E3))).toEqual([]);
    expect(await run('RLS Q2', '', (q) => q.searchSegments(A1, 'english', 'cult or leader'))).toEqual([]);
    expect(await run('RLS Q3', '', (q) => q.hybridSearch(A1, 'english', 'cult or leader', QV))).toEqual([]);
    expect(await withTenant(db, '', (tx) => tx.$count(claimCurrent))).toBe(0);
    // And with the tenant unset entirely (set_config never called).
    expect(await run('RLS Q1 (null)', null, (q) => q.graphHops(E3))).toEqual([]);
    expect(await withTenant(db, null, (tx) => tx.$count(claimCurrent))).toBe(0);
  });
});

describe('Q4 SKIP LOCKED queue', () => {
  test('Q4 W1/W2/W3 claims do not block, complete/retry/foreign-lock semantics hold', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const claimed: Record<string, { id: string; kind: string; payload: unknown; attempts: number }[]> = {};
    const within = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`blocked > ${ms} ms`)), ms))]);

    // W1 claims 3 and keeps its transaction open until released.
    let w1Claimed!: () => void;
    const w1Got = new Promise<void>((r) => (w1Claimed = r));
    const w1 = withTenant(db, TENANT_A, async (tx) => {
      label = 'Q4 claimJobs (W1)';
      claimed.W1 = await exp1(tx, TENANT_A).claimJobs('W1', 3);
      w1Claimed();
      await held;
    });
    await w1Got;

    // W2 claims while W1's transaction is open.
    let w2Claimed!: () => void;
    const w2Got = new Promise<void>((r) => (w2Claimed = r));
    const t0 = Date.now();
    const w2 = withTenant(db, TENANT_A, async (tx) => {
      label = 'Q4 claimJobs (W2)';
      claimed.W2 = await exp1(tx, TENANT_A).claimJobs('W2', 3);
      w2Claimed();
      await held;
    });
    await within(w2Got, 5000);
    const w2Ms = Date.now() - t0;
    // W3 claims while both are open.
    const t1 = Date.now();
    const w3 = await within(
      withTenant(db, TENANT_A, (tx) => {
        label = 'Q4 claimJobs (W3)';
        return exp1(tx, TENANT_A).claimJobs('W3', 3);
      }),
      5000,
    );
    saveOutput(
      'exp1-q4-timing.txt',
      `W2 claim returned ${w2Ms} ms after W1 claimed, W1 transaction still open\nW3 claim returned ${Date.now() - t1} ms, W1 and W2 open\n`,
    );

    expect(claimed.W1!.map((j) => [ord(j.id), j.attempts])).toEqual([[1, 1], [2, 1], [3, 1]]);
    expect(claimed.W2!.map((j) => [ord(j.id), j.attempts])).toEqual([[4, 1], [5, 1], [6, 3]]);
    expect(w3).toEqual([]);
    expectTypeOf(claimed.W1![0]!).toEqualTypeOf<{ id: string; kind: string; payload: unknown; attempts: number }>();

    release();
    await Promise.all([w1, w2]);

    const done1 = await run('Q4 completeJob', TENANT_A, (q) => q.completeJob('0000000a-0003-7000-8000-000000000001', 'W1'));
    const retry2 = await run('Q4 retryJob', TENANT_A, (q) => q.retryJob('0000000a-0003-7000-8000-000000000002', 'W1'));
    const retry6 = await run('Q4 retryJob (attempt 3)', TENANT_A, (q) => q.retryJob('0000000a-0003-7000-8000-000000000006', 'W2'));
    const foreign3 = await run('Q4 completeJob (foreign lock)', TENANT_A, (q) => q.completeJob('0000000a-0003-7000-8000-000000000003', 'W2'));
    expect(done1.map((r) => [ord(r.id), r.state])).toEqual([[1, 'done']]);
    expect(retry2.map((r) => [ord(r.id), r.state, r.attempts])).toEqual([[2, 'queued', 1]]);
    expect(retry6.map((r) => [ord(r.id), r.state, r.attempts])).toEqual([[6, 'failed', 3]]);
    expect(foreign3).toEqual([]);

    const check = new pg.Client({ connectionString: url('exp1_drizzle', 'migrator') });
    await check.connect();
    try {
      const rows = (
        await check.query<{ tenant: string; n: number; state: string; attempts: number; locked_by: string | null; delay: number }>(
          `select right(tenant_id::text, 1) as tenant, right(id::text, 1)::int as n, state, attempts, locked_by,
                  extract(epoch from (run_after - now()))::float8 as delay
           from job order by tenant_id, id`,
        )
      ).rows;
      const a = (n: number) => rows.find((r) => r.tenant === 'a' && r.n === n)!;
      expect(a(1)).toMatchObject({ state: 'done', locked_by: null });
      expect(a(2)).toMatchObject({ state: 'queued', attempts: 1, locked_by: null });
      expect(a(2).delay).toBeGreaterThanOrEqual(25);
      expect(a(3)).toMatchObject({ state: 'running', attempts: 1, locked_by: 'W1' });
      expect(a(4)).toMatchObject({ state: 'running', attempts: 1, locked_by: 'W2' });
      expect(a(5)).toMatchObject({ state: 'running', attempts: 1, locked_by: 'W2' });
      expect(a(6)).toMatchObject({ state: 'failed', attempts: 3, locked_by: null });
      expect(a(7)).toMatchObject({ state: 'queued', attempts: 0 });
      expect(a(8)).toMatchObject({ state: 'done', attempts: 1 });
      expect(rows.filter((r) => r.tenant === 'b').map((r) => [r.state, r.attempts])).toEqual([['queued', 0], ['queued', 0]]);
    } finally {
      await check.end();
    }
  });
});

describe('EXPLAIN (evidence, not scored)', () => {
  test('EXPLAIN (COSTS OFF) with enable_seqscan = off for each query', async () => {
    const out: string[] = [];
    const targets: [string, string][] = [
      ['Q1 graphHops', 'Q1 graphHops'],
      ['Q2 searchSegments', 'Q2 searchSegments'],
      ['Q3 hybridSearch', 'Q3 hybridSearch'],
      ['Q4 claimJobs (W1)', 'Q4 claimJobs'],
    ];
    const c = new pg.Client({ connectionString: url('exp1_drizzle', 'app') });
    await c.connect();
    try {
      for (const [l, title] of targets) {
        const stmt = captured.get(l)?.[0];
        expect(stmt, `no captured SQL for ${l}`).toBeDefined();
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
        await c.query('set local enable_seqscan = off');
        const plan = await c.query<{ 'QUERY PLAN': string }>(`explain (costs off) ${stmt!.query}`, stmt!.params as unknown[]);
        await c.query('rollback');
        out.push(`== ${title}\n${plan.rows.map((r) => r['QUERY PLAN']).join('\n')}\n`);
      }
    } finally {
      await c.end();
    }
    saveOutput('exp1-explain.txt', out.join('\n'));
    expect(out).toHaveLength(4);
  });
});
