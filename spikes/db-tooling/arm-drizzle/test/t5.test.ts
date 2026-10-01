// T5: expand and contract with two versions of application code in flight, on drizzle_t5.
//
// Drizzle's types come from the TypeScript table definitions, not from the database, so "two schema versions in
// flight" means two table modules imported side by side:
//   - v1 code imports src/schema/m1.ts (entity.name).
//   - v2 code imports src/schema/m3.ts (entity.display_name only). It must NOT be typed against m2.ts: drizzle lists
//     every declared column in SELECT and RETURNING, so code that declares `name` breaks the moment M3 drops it.
//     m2.ts exists to describe the database at M2 for drizzle-kit, not for application code.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connect, withTenant } from '../src/db.ts';
import { migrateTo } from '../src/migrations.ts';
import * as m1 from '../src/schema/m1.ts';
import * as m2 from '../src/schema/m2.ts';
import * as v2 from '../src/schema/m3.ts';
import { pgError, uuid } from './helpers.ts';

const db = connect('drizzle_t5', 'app');
const tenant = uuid();
const campaign = uuid();
const ids = { pre: uuid(), v1: uuid(), v2: uuid(), m2: uuid() };

beforeAll(async () => {
  await migrateTo('drizzle_t5', 'm1');
  await withTenant(db, tenant, async (tx) => {
    await tx.insert(m1.tenant).values({ id: tenant, name: 't5' });
    await tx.insert(m1.campaign).values({ tenantId: tenant, id: campaign, name: 'c' });
    await tx.insert(m1.entity).values({ tenantId: tenant, id: ids.pre, campaignId: campaign, kind: 'npc', name: 'Pre' });
  });
});
afterAll(() => db.$client.end());

const both = (id: string) =>
  withTenant(db, tenant, async (tx) => {
    const [a] = await tx.select({ name: m1.entity.name }).from(m1.entity).where(eq(m1.entity.id, id));
    const [b] = await tx.select({ displayName: v2.entity.displayName }).from(v2.entity).where(eq(v2.entity.id, id));
    return { name: a?.name, displayName: b?.displayName };
  });

describe('T5 expand and contract', () => {
  test('T5 M2 backfills display_name from name', async () => {
    await migrateTo('drizzle_t5', 'm2');
    expect(await both(ids.pre)).toEqual({ name: 'Pre', displayName: 'Pre' });
  });

  test('T5 between M2 and M3, v1 and v2 code run side by side and their writes appear in both columns', async () => {
    // Concurrent inserts from both code versions.
    await Promise.all([
      withTenant(db, tenant, (tx) =>
        tx.insert(m1.entity).values({ tenantId: tenant, id: ids.v1, campaignId: campaign, kind: 'npc', name: 'Old code' }),
      ),
      withTenant(db, tenant, (tx) =>
        tx.insert(v2.entity).values({ tenantId: tenant, id: ids.v2, campaignId: campaign, kind: 'npc', displayName: 'New code' }),
      ),
      // Typed against m2.ts: `name` is required by the type, so it carries a client-side SQL NULL default.
      withTenant(db, tenant, (tx) =>
        tx.insert(m2.entity).values({ tenantId: tenant, id: ids.m2, campaignId: campaign, kind: 'npc', displayName: 'M2 module' }),
      ),
    ]);
    expect(await both(ids.v1)).toEqual({ name: 'Old code', displayName: 'Old code' });
    expect(await both(ids.v2)).toEqual({ name: 'New code', displayName: 'New code' });
    expect(await both(ids.m2)).toEqual({ name: 'M2 module', displayName: 'M2 module' });

    // Cross updates: each version updates the row the other wrote.
    await Promise.all([
      withTenant(db, tenant, (tx) => tx.update(m1.entity).set({ name: 'Renamed by v1' }).where(eq(m1.entity.id, ids.v2))),
      withTenant(db, tenant, (tx) =>
        tx.update(v2.entity).set({ displayName: 'Renamed by v2' }).where(eq(v2.entity.id, ids.v1)),
      ),
    ]);
    expect(await both(ids.v2)).toEqual({ name: 'Renamed by v1', displayName: 'Renamed by v1' });
    expect(await both(ids.v1)).toEqual({ name: 'Renamed by v2', displayName: 'Renamed by v2' });

    // Full-row reads with each module work too.
    await withTenant(db, tenant, async (tx) => {
      expect(await tx.select().from(m1.entity)).toHaveLength(4);
      expect(await tx.select().from(m2.entity)).toHaveLength(4);
      expect(await tx.select().from(v2.entity)).toHaveLength(4);
    });
  });

  test('T5 after M3, v2 code still works; v1 code and code typed against m2.ts fail on the dropped column', async () => {
    await migrateTo('drizzle_t5', 'm3');
    const id = uuid();
    await withTenant(db, tenant, async (tx) => {
      await tx.insert(v2.entity).values({ tenantId: tenant, id, campaignId: campaign, kind: 'npc', displayName: 'After M3' });
      await tx.update(v2.entity).set({ displayName: 'After M3, updated' }).where(eq(v2.entity.id, id));
      const rows = await tx.select().from(v2.entity);
      expect(rows.map((r) => r.displayName).sort()).toEqual(
        ['After M3, updated', 'M2 module', 'Pre', 'Renamed by v1', 'Renamed by v2'].sort(),
      );
    });

    const v1Read = await pgError(withTenant(db, tenant, (tx) => tx.select().from(m1.entity)));
    expect(v1Read.code).toBe('42703'); // undefined_column: expected, v1 code must be retired before M3
    const m2Read = await pgError(withTenant(db, tenant, (tx) => tx.select().from(m2.entity)));
    expect(m2Read.code).toBe('42703');
    expect(m2Read.message).toMatch(/column .*name.* does not exist/);
  });
});
