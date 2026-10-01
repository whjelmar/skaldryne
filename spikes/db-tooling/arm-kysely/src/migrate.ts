// Thin wrapper around graphile-migrate's programmatic API, plus the superuser bootstrap.
import { readFile, mkdir, copyFile, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { migrate, type Settings } from "graphile-migrate";
import { url, SHADOW_DB } from "./config.ts";

export const ARM_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = join(ARM_DIR, "migrations");
export function settingsFor(database: string, migrationsFolder = MIGRATIONS_DIR): Settings {
  return {
    connectionString: url("skal_migrator", database),
    shadowConnectionString: url("skal_migrator", SHADOW_DB),
    rootConnectionString: url("postgres", "postgres"),
    migrationsFolder,
    afterReset: [{ _: "sql", file: "../db/bootstrap-extensions.sql", root: true }],
  };
}

/** Drop and recreate a kysely_* database owned by skal_migrator, then create extensions as postgres. */
export async function bootstrapDatabase(database: string): Promise<void> {
  url("postgres", database); // prefix guard
  const root = new pg.Client({ connectionString: url("postgres", "postgres") });
  await root.connect();
  try {
    await root.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await root.query(`CREATE DATABASE "${database}" OWNER skal_migrator`);
  } finally {
    await root.end();
  }
  const extSql = await readFile(join(ARM_DIR, "db", "bootstrap-extensions.sql"), "utf8");
  const db = new pg.Client({ connectionString: url("postgres", database) });
  await db.connect();
  try {
    await db.query(extSql);
  } finally {
    await db.end();
  }
}

export async function dropDatabase(database: string): Promise<void> {
  url("postgres", database);
  const root = new pg.Client({ connectionString: url("postgres", "postgres") });
  await root.connect();
  try {
    await root.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await root.end();
  }
}

/** Apply every committed migration in `migrationsFolder` (default: the real one). */
export async function migrateDatabase(database: string, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  await migrate(settingsFor(database, migrationsFolder));
}

/**
 * graphile-migrate always applies *all* committed migrations; it has no "migrate to version N".
 * To hold a database at M1 or M2 we build a temporary migrations folder holding only a prefix of
 * the committed chain (valid, because each file's hash chains to the previous one).
 */
export async function prefixFolder(name: string, count: number): Promise<string> {
  const folder = join(ARM_DIR, ".tmp", name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "committed"), { recursive: true });
  const files = (await readdir(join(MIGRATIONS_DIR, "committed"))).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.slice(0, count)) {
    await copyFile(join(MIGRATIONS_DIR, "committed", f), join(folder, "committed", f));
  }
  return folder;
}

export interface AppliedMigration {
  filename: string;
  hash: string;
  previous_hash: string | null;
}

export async function appliedMigrations(database: string): Promise<AppliedMigration[]> {
  const c = new pg.Client({ connectionString: url("skal_migrator", database) });
  await c.connect();
  try {
    const { rows } = await c.query<AppliedMigration>(
      "select filename, hash, previous_hash from graphile_migrate.migrations order by filename",
    );
    return rows;
  } finally {
    await c.end();
  }
}
