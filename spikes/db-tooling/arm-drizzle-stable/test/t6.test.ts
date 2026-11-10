// T6: safe to repeat. (a) re-applying is a no-op, (b) a broken M2 leaves the database unchanged, (c) idempotent import.
// Plus the stable-line focus: how pending migrations are grouped into transactions.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, test } from 'vitest';
import { connect, url, withTenant } from '../src/db.ts';
import { importBatch, type ImportItem } from '../src/importer.ts';
import { appliedMigrations, copyMigrations, foldersUpTo, MIGRATIONS_DIR, migrateDatabase, migrateTo, readJournal } from '../src/migrations.ts';
import * as s from '../src/schema/m3.ts';
import { drizzleKit, fingerprint, pgError, saveOutput, seedTenant } from './helpers.ts';

const db = connect('drizzle045_app', 'app');
afterAll(() => db.$client.end());

async function query<T extends pg.QueryResultRow>(database: string, text: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url(database, 'migrator') });
  await c.connect();
  try {
    return (await c.query<T>(text)).rows;
  } finally {
    await c.end();
  }
}

describe('T6 safe to repeat', () => {
  test('T6a applying migrations to an up-to-date database changes nothing', async () => {
    const before = await fingerprint('drizzle045_app');
    const rowsBefore = await appliedMigrations('drizzle045_app');
    await migrateDatabase('drizzle045_app');
    await migrateDatabase('drizzle045_app');
    expect(await fingerprint('drizzle045_app')).toBe(before);
    expect(await appliedMigrations('drizzle045_app')).toEqual(rowsBefore);
    expect(rowsBefore).toHaveLength(foldersUpTo('m3').length);
  });

  test('T6b a broken M2 fails, leaves the database unchanged, and the fixed M2 then completes', async () => {
    await migrateTo('drizzle045_t6', 'm1');
    const atM1 = await fingerprint('drizzle045_t6');

    // Copy M1+M2 and break the second M2 file after its backfill and function, before its trigger.
    const broken = copyMigrations(MIGRATIONS_DIR, foldersUpTo('m2'));
    const target = join(broken, `${foldersUpTo('m2').find((n) => n.endsWith('m2_expand_backfill_sync'))!}.sql`);
    const original = readFileSync(target, 'utf8');
    writeFileSync(target, original.replace('CREATE TRIGGER', 'SELECT 1/0;\n--> statement-breakpoint\nCREATE TRIGGER'));

    const err = await pgError(migrateDatabase('drizzle045_t6', broken));
    expect(err.code).toBe('22012'); // division_by_zero
    // Only the SECOND pending file fails, yet the FIRST file's ADD COLUMN is rolled back too: all pending files share one transaction.
    expect(await fingerprint('drizzle045_t6')).toBe(atM1);
    expect((await appliedMigrations('drizzle045_t6')).map((m) => m.name)).toEqual(foldersUpTo('m1'));

    // Fix it (restore the file in place) and run again.
    writeFileSync(target, original);
    await migrateDatabase('drizzle045_t6', broken);
    expect((await appliedMigrations('drizzle045_t6')).map((m) => m.name)).toEqual(foldersUpTo('m2'));
    expect(await fingerprint('drizzle045_t6')).not.toBe(atM1);
  });

  test('T6 (focus) the ORM migrator runs every pending file in ONE transaction', async () => {
    // Prove it with the transaction id: write the xid at the start of two different pending files and compare.
    const tags = foldersUpTo('m3');
    const pending = tags.filter((t) => !foldersUpTo('m1').includes(t));
    expect(pending).toHaveLength(4);
    const probe = copyMigrations(MIGRATIONS_DIR, tags);
    const first = join(probe, `${pending[0]}.sql`);
    const last = join(probe, `${pending[3]}.sql`);
    writeFileSync(
      first,
      `CREATE TABLE xid_probe (file int, xid text);\n--> statement-breakpoint\nINSERT INTO xid_probe VALUES (1, pg_current_xact_id()::text);\n--> statement-breakpoint\n${readFileSync(first, 'utf8')}`,
    );
    writeFileSync(last, `INSERT INTO xid_probe VALUES (4, pg_current_xact_id()::text);\n--> statement-breakpoint\n${readFileSync(last, 'utf8')}`);
    await migrateTo('drizzle045_t6b', 'm1');
    await migrateDatabase('drizzle045_t6b', probe);
    const xids = await query<{ file: number; xid: string }>('drizzle045_t6b', 'select file, xid from xid_probe order by file');
    expect(xids.map((x) => x.file)).toEqual([1, 4]);
    expect(xids[0]!.xid).toBe(xids[1]!.xid);
  });

  test('T6 (focus) `drizzle-kit migrate` with only the second pending file broken rolls back the first too', async () => {
    const tags = foldersUpTo('m3');
    const pending = tags.filter((t) => !foldersUpTo('m1').includes(t));
    await migrateTo('drizzle045_t6c', 'm1');
    const atM1 = await fingerprint('drizzle045_t6c');
    const dir = copyMigrations(MIGRATIONS_DIR, tags);
    const second = join(dir, `${pending[1]}.sql`);
    writeFileSync(second, `SELECT 1/0;\n--> statement-breakpoint\n${readFileSync(second, 'utf8')}`);
    const r = drizzleKit(['migrate'], { DATABASE_URL: url('drizzle045_t6c', 'migrator'), MIGRATIONS_OUT: dir });
    saveOutput('t6-kit-migrate-batch.txt', r.output);
    expect(r.code).not.toBe(0);
    // Finding: with drizzle-kit 0.31.11 the failing run exits non-zero but prints no Postgres error text at all (see out/t6-kit-migrate-batch.txt).
    expect(r.output).not.toMatch(/division by zero|22012/i);
    expect(await fingerprint('drizzle045_t6c')).toBe(atM1); // file 1 (ADD COLUMN) was rolled back with file 2
  });

  test('T6 (finding) the migrator does not notice that an already-applied migration was edited', async () => {
    // drizzle045_t6 is at M2 after T6b. Edit an applied M1 file, then migrate the rest.
    const edited = copyMigrations(MIGRATIONS_DIR, foldersUpTo('m3'));
    const m1File = join(edited, `${foldersUpTo('m1').at(-1)!}.sql`);
    writeFileSync(m1File, readFileSync(m1File, 'utf8').replace('TO skal_app;', 'TO skal_app; -- edited after apply'));
    const before = await appliedMigrations('drizzle045_t6');
    await migrateDatabase('drizzle045_t6', edited); // no error, no warning
    const after = await appliedMigrations('drizzle045_t6');
    expect(after.map((m) => m.name)).toEqual(foldersUpTo('m3'));
    expect(after.slice(0, before.length)).toEqual(before); // stored hash of the edited file is the old one
  });

  test('T6 (finding, 0.45) a file whose journal timestamp is older than the newest applied one is skipped silently', async () => {
    // 0.45 decides what is pending by comparing the journal `when` with MAX(created_at) in the database; there is
    // no per-file name or hash check. A file merged late with an earlier timestamp (the branch-merge case) never runs.
    const dir = copyMigrations(MIGRATIONS_DIR, foldersUpTo('m3'));
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = readJournal(dir);
    const lateTag = '0099_late_branch';
    writeFileSync(join(dir, `${lateTag}.sql`), 'CREATE TABLE late_branch (id int);');
    journal.entries.push({ idx: journal.entries.length, version: '7', when: journal.entries[2]!.when + 1, tag: lateTag, breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(journal));
    await migrateDatabase('drizzle045_t6', dir); // no error: drizzle045_t6 is already at M3
    expect((await query<{ t: string | null }>('drizzle045_t6', `select to_regclass('public.late_branch') as t`))[0]!.t).toBeNull();
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
