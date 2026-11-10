// Programmatic migration helpers around drizzle-orm's node-postgres migrator (0.45 layout: flat NNNN_name.sql
// files plus meta/_journal.json).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { url } from './db.ts';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'drizzle');
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

export type Stage = 'm1' | 'm2' | 'm3';
const STAGES: Stage[] = ['m1', 'm2', 'm3'];

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export function readJournal(dir = MIGRATIONS_DIR): Journal {
  return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as Journal;
}

function entriesUpTo(stage: Stage, dir: string): JournalEntry[] {
  const allowed = STAGES.slice(0, STAGES.indexOf(stage) + 1);
  return readJournal(dir).entries.filter((e) => allowed.some((s) => e.tag.includes(`_${s}_`)));
}

/** Migration tags (file names without .sql), in journal order, that belong to stages up to and including `stage`. */
export function foldersUpTo(stage: Stage, dir = MIGRATIONS_DIR): string[] {
  return entriesUpTo(stage, dir).map((e) => e.tag);
}

/**
 * The migrator has no "target version" option: it applies every journal entry newer than the last applied one.
 * To stop at a stage, copy that stage's files and a truncated journal into a temporary directory.
 */
export function stagedFolder(stage: Stage, dir = MIGRATIONS_DIR): string {
  if (stage === 'm3') return dir;
  const entries = entriesUpTo(stage, dir);
  return copyMigrations(dir, entries.map((e) => e.tag));
}

/** Copy the named migrations (files + a journal holding only them) to a temp directory. */
export function copyMigrations(dir: string, tags: string[]): string {
  const tmp = mkdtempSync(join(tmpdir(), 'drizzle045-'));
  mkdirSync(join(tmp, 'meta'));
  const journal = readJournal(dir);
  journal.entries = journal.entries.filter((e) => tags.includes(e.tag));
  writeFileSync(join(tmp, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));
  for (const tag of tags) cpSync(join(dir, `${tag}.sql`), join(tmp, `${tag}.sql`));
  return tmp;
}

export async function migrateDatabase(database: string, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  const client = new pg.Pool({ connectionString: url(database, 'migrator'), max: 1 });
  try {
    await migrate(drizzle({ client }), {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
  } finally {
    await client.end();
  }
}

export async function migrateTo(database: string, stage: Stage): Promise<void> {
  await migrateDatabase(database, stagedFolder(stage));
}

export interface AppliedMigration {
  id: number;
  /** Not stored by 0.45: derived by matching created_at with the journal's `when`. */
  name: string | null;
  hash: string;
  /** The journal `when` (ms since epoch) of the migration, as stored. */
  createdAt: string;
}

/** The migrator's own bookkeeping: one row per applied migration: (id, hash, created_at). No name column in 0.45. */
export async function appliedMigrations(database: string): Promise<AppliedMigration[]> {
  const client = new pg.Pool({ connectionString: url(database, 'migrator'), max: 1 });
  try {
    const db = drizzle({ client });
    const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
    if (!exists.rows[0]?.t) return [];
    const res = await db.execute<{ id: number; hash: string; created_at: string }>(
      sql`select id, hash, created_at::text from drizzle.__drizzle_migrations order by id`,
    );
    const byWhen = new Map(readJournal().entries.map((e) => [String(e.when), e.tag]));
    return res.rows.map((r) => ({ id: r.id, name: byWhen.get(r.created_at) ?? null, hash: r.hash, createdAt: r.created_at }));
  } finally {
    await client.end();
  }
}
