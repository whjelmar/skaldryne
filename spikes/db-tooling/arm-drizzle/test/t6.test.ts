// T6: safe to repeat. (a) re-applying is a no-op, (b) a broken M2 leaves the database unchanged, (c) idempotent import.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { connect, withTenant } from '../src/db.ts';
import { importBatch, type ImportItem } from '../src/importer.ts';
import { appliedMigrations, foldersUpTo, MIGRATIONS_DIR, migrateDatabase, migrateTo } from '../src/migrations.ts';
import * as s from '../src/schema/m3.ts';
import { fingerprint, pgError, seedTenant } from './helpers.ts';

const db = connect('drizzle_app', 'app');
afterAll(() => db.$client.end());

describe('T6 safe to repeat', () => {
  test('T6a applying migrations to an up-to-date database changes nothing', async () => {
    const before = await fingerprint('drizzle_app');
    const rowsBefore = await appliedMigrations('drizzle_app');
    await migrateDatabase('drizzle_app');
    await migrateDatabase('drizzle_app');
    expect(await fingerprint('drizzle_app')).toBe(before);
    expect(await appliedMigrations('drizzle_app')).toEqual(rowsBefore);
    expect(rowsBefore).toHaveLength(foldersUpTo('m3').length);
  });

  test('T6b a broken M2 fails, leaves the database unchanged, and the fixed M2 then completes', async () => {
    await migrateTo('drizzle_t6', 'm1');
    const atM1 = await fingerprint('drizzle_t6');

    // Copy M1+M2 and break the second M2 migration after its backfill and function, before its trigger.
    const broken = mkdtempSync(join(tmpdir(), 'drizzle-broken-'));
    for (const name of foldersUpTo('m2')) cpSync(join(MIGRATIONS_DIR, name), join(broken, name), { recursive: true });
    const target = join(broken, foldersUpTo('m2').find((n) => n.endsWith('m2_expand_backfill_sync'))!, 'migration.sql');
    const original = readFileSync(target, 'utf8');
    writeFileSync(target, original.replace('CREATE TRIGGER', 'SELECT 1/0;\n--> statement-breakpoint\nCREATE TRIGGER'));

    const err = await pgError(migrateDatabase('drizzle_t6', broken));
    expect(err.code).toBe('22012'); // division_by_zero
    // All pending migrations run in one transaction, so even the ADD COLUMN from the first M2 folder is rolled back.
    expect(await fingerprint('drizzle_t6')).toBe(atM1);
    expect((await appliedMigrations('drizzle_t6')).map((m) => m.name)).toEqual(foldersUpTo('m1'));

    // Fix it (restore the file in place, same folder name) and run again.
    writeFileSync(target, original);
    await migrateDatabase('drizzle_t6', broken);
    expect((await appliedMigrations('drizzle_t6')).map((m) => m.name)).toEqual(foldersUpTo('m2'));
    expect(await fingerprint('drizzle_t6')).not.toBe(atM1);
  });

  test('T6 (finding) the migrator does not notice that an already-applied migration was edited', async () => {
    // drizzle_t6 is at M2 after T6b. Edit an applied M1 file, then migrate the rest.
    const edited = mkdtempSync(join(tmpdir(), 'drizzle-edited-'));
    cpSync(MIGRATIONS_DIR, edited, { recursive: true });
    const m1File = join(edited, foldersUpTo('m1').at(-1)!, 'migration.sql');
    writeFileSync(m1File, readFileSync(m1File, 'utf8').replace('TO skal_app;', 'TO skal_app; -- edited after apply'));
    const before = await appliedMigrations('drizzle_t6');
    await migrateDatabase('drizzle_t6', edited); // no error, no warning
    const after = await appliedMigrations('drizzle_t6');
    expect(after.map((m) => m.name)).toEqual(foldersUpTo('m3'));
    expect(after.slice(0, before.length)).toEqual(before); // stored hash of the edited file is the old one
  });

  test('T6c importing the same 50 entities with claims twice adds nothing the second time', async () => {
    const t = await seedTenant(db, 't6-import');
    const items: ImportItem[] = Array.from({ length: 50 }, (_, i) => ({
      key: `row-${i}`,
      kind: i % 2 ? 'npc' : 'place',
      displayName: `Imported ${i}`,
      claims: [
        { predicate: 'title', object: `title ${i}` },
        { predicate: 'level', object: i },
      ],
    }));
    const counts = () =>
      withTenant(db, t.tenant, async (tx) => ({
        entity: await tx.$count(s.entity),
        importRecord: await tx.$count(s.importRecord),
        claimVersion: await tx.$count(s.claimVersion),
        claimCurrent: await tx.$count(s.claimCurrent),
      }));

    const start = await counts();
    const first = await importBatch(db, t.tenant, t.campaign, 'csv', items);
    const afterFirst = await counts();
    const second = await importBatch(db, t.tenant, t.campaign, 'csv', items);
    const afterSecond = await counts();

    expect(first).toEqual({ imported: 50, unchanged: 0, claimVersions: 100 });
    expect(afterFirst).toEqual({
      entity: start.entity + 50,
      importRecord: start.importRecord + 50,
      claimVersion: start.claimVersion + 100,
      claimCurrent: start.claimCurrent + 100,
    });
    expect(second).toEqual({ imported: 0, unchanged: 50, claimVersions: 0 });
    expect(afterSecond).toEqual(afterFirst);

    // A changed item produces exactly one new claim version for the changed claim.
    const changed = items.map((it, i) => (i === 7 ? { ...it, claims: [it.claims[0]!, { predicate: 'level', object: 99 }] } : it));
    expect(await importBatch(db, t.tenant, t.campaign, 'csv', changed)).toEqual({ imported: 1, unchanged: 49, claimVersions: 1 });
  });
});
