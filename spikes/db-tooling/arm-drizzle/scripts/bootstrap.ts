// Drop and recreate every drizzle_* database, then migrate drizzle_app to M3.
// Connects as postgres only for database/extension creation; migrations run as skal_migrator.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { url } from '../src/db.ts';
import { migrateDatabase } from '../src/migrations.ts';

export const DATABASES = [
  'drizzle_app', // M3, used by T1-T4, T6a, T8
  'drizzle_t5', // expand/contract walk-through
  'drizzle_t6', // broken-migration rollback
  'drizzle_fleet_a', // T7, left at M1 by the test
  'drizzle_fleet_b', // T7, left at M2 by the test
  'drizzle_reference', // reference/schema.sql applied verbatim, for catalog comparison
] as const;

async function run(database: string, user: 'postgres' | 'migrator', statements: string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url(database, user) });
  await client.connect();
  try {
    for (const s of statements) await client.query(s);
  } finally {
    await client.end();
  }
}

export async function recreate(database: string): Promise<void> {
  if (!database.startsWith('drizzle_')) throw new Error(`refusing to touch ${database}`);
  await run('postgres', 'postgres', [
    `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
    `CREATE DATABASE ${database} OWNER skal_migrator`,
  ]);
  await run(database, 'postgres', [
    'CREATE EXTENSION vector',
    'CREATE SCHEMA tap',
    'CREATE EXTENSION pgtap SCHEMA tap',
    // pgTAP (T8b) runs as skal_migrator, not postgres.
    'GRANT USAGE ON SCHEMA tap TO skal_migrator',
  ]);
}

export async function bootstrap(): Promise<void> {
  for (const db of DATABASES) await recreate(db);
  const reference = readFileSync(resolve(import.meta.dirname, '..', '..', 'reference', 'schema.sql'), 'utf8');
  await run('drizzle_reference', 'migrator', [reference]);
  await migrateDatabase('drizzle_app');
}

if (import.meta.main) {
  const t0 = Date.now();
  await bootstrap();
  console.log(`bootstrap: recreated ${DATABASES.join(', ')}; drizzle_app migrated to M3 in ${Date.now() - t0} ms`);
}
