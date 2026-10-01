// Drops and recreates this arm's databases as the postgres superuser.
// Only databases prefixed `prisma_` are ever touched.
import pg from "pg";

export const HOST = process.env["PGHOST"] ?? "localhost";
export const PORT = Number(process.env["PGPORT"] ?? 55432);

export const url = (user: string, password: string, db: string) =>
  `postgresql://${user}:${password}@${HOST}:${PORT}/${db}`;
export const migratorUrl = (db: string) => url("skal_migrator", "migrator", db);
export const appUrl = (db: string) => url("skal_app", "app", db);

export async function recreateDatabase(name: string): Promise<void> {
  if (!/^prisma_[a-z0-9_]+$/.test(name)) throw new Error(`refusing to touch database ${name}`);
  const admin = new pg.Client({ connectionString: url("postgres", "postgres", "postgres") });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER skal_migrator`);
  } finally {
    await admin.end();
  }
  const db = new pg.Client({ connectionString: url("postgres", "postgres", name) });
  await db.connect();
  try {
    await db.query("CREATE EXTENSION vector");
    await db.query("CREATE SCHEMA tap");
    await db.query("CREATE EXTENSION pgtap SCHEMA tap");
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("bootstrap.ts")) {
  const names = process.argv.slice(2);
  for (const n of names) {
    await recreateDatabase(n);
    console.log(`recreated ${n}`);
  }
}
