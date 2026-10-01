// Programmatic migration helpers around drizzle-orm's node-postgres migrator.
import { mkdtempSync, readdirSync, cpSync } from 'node:fs';
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

/** Migration folder names, in order, that belong to stages up to and including `stage`. */
export function foldersUpTo(stage: Stage, dir = MIGRATIONS_DIR): string[] {
  const allowed = STAGES.slice(0, STAGES.indexOf(stage) + 1);
  return readdirSync(dir)
    .filter((name) => allowed.some((s) => name.includes(`_${s}_`)))
    .sort();
}

/**
 * The migrator has no "target version" option: it applies every folder it finds whose name is not yet recorded.
 * To stop at a stage, copy that stage's folders into a temporary directory and point the migrator there.
 */
export function stagedFolder(stage: Stage, dir = MIGRATIONS_DIR): string {
  if (stage === 'm3') return dir;
  const tmp = mkdtempSync(join(tmpdir(), `drizzle-${stage}-`));
  for (const name of foldersUpTo(stage, dir)) cpSync(join(dir, name), join(tmp, name), { recursive: true });
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
  name: string | null;
  hash: string;
  createdAt: string;
}

/** The migrator's own bookkeeping: one row per applied migration folder. */
export async function appliedMigrations(database: string): Promise<AppliedMigration[]> {
  const client = new pg.Pool({ connectionString: url(database, 'migrator'), max: 1 });
  try {
    const db = drizzle({ client });
    const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
    if (!exists.rows[0]?.t) return [];
    const res = await db.execute<{ id: number; name: string | null; hash: string; created_at: string }>(
      sql`select id, name, hash, created_at::text from drizzle.__drizzle_migrations order by id`,
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name, hash: r.hash, createdAt: r.created_at }));
  } finally {
    await client.end();
  }
}
