// T2: per-transaction tenant context through drizzle's transaction API, on a pool of size 1.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, withTenant } from '../src/db.ts';
import * as s from '../src/schema/m3.ts';
import { seedTenant, type SeededTenant } from './helpers.ts';

const seeder = connect('drizzle_app', 'app');
const db = connect('drizzle_app', 'app', 1); // a pool of exactly one connection
let A: SeededTenant;
let B: SeededTenant;

beforeAll(async () => {
  A = await seedTenant(seeder, 't2-A');
  B = await seedTenant(seeder, 't2-B');
});
afterAll(async () => {
  await seeder.$client.end();
  await db.$client.end();
});

// One "request": read entities and campaigns, yielding to the event loop between queries so requests interleave.
async function request(tenantId: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    const entities = await tx.select({ tenantId: s.entity.tenantId }).from(s.entity);
    await tx.execute(sql`select pg_sleep(0.01)`);
    const campaigns = await tx.select({ tenantId: s.campaign.tenantId }).from(s.campaign);
    return { pid: backend.rows[0]!.pid, tenants: new Set([...entities, ...campaigns].map((r) => r.tenantId)) };
  });
}

describe('T2 pooling', () => {
  test('T2 interleaved A, B and no-tenant requests on one pooled connection never see each other', async () => {
    const order = Array.from({ length: 30 }, (_, i) => [A.tenant, B.tenant, null][i % 3] ?? null);
    const results = await Promise.all(order.map((t) => request(t)));

    expect(new Set(results.map((r) => r.pid)).size).toBe(1); // really one backend
    results.forEach((r, i) => {
      const t = order[i];
      if (t === null) expect([...r.tenants]).toEqual([]);
      else expect([...r.tenants]).toEqual([t]);
    });
  });

  test('T2 the setting does not outlive its transaction, even when the transaction fails', async () => {
    await expect(
      withTenant(db, A.tenant, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Outside any transaction, on the same (only) connection.
    const after = await db.execute<{ v: string | null }>(sql`select current_setting('app.tenant_id', true) as v`);
    expect(after.rows[0]!.v ?? '').toBe('');
    expect(await db.$count(s.entity)).toBe(0);
  });
});
