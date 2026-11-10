// Create, migrate and drop schema5_ databases. Mirrors what arm-kysely-stable's migrate.ts does.
import { mkdir, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "graphile-migrate";
import { url, withClient } from "./env.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

export async function createDatabase(name: string, opts: { template?: string } = {}): Promise<void> {
  url("postgres", name);
  await withClient("postgres", "postgres", async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}" OWNER skal_migrator${opts.template ? ` TEMPLATE "${opts.template}"` : ""}`);
  });
  if (!opts.template) {
    // pgvector is not a trusted extension: this one statement needs the superuser.
    await withClient("postgres", name, (c) => c.query("CREATE EXTENSION IF NOT EXISTS vector"));
  }
}

export async function dropDatabase(name: string): Promise<void> {
  url("postgres", name);
  await withClient("postgres", "postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** Apply every committed migration in `folder` that the database has not seen yet. */
export async function migrateDatabase(name: string, folder: string): Promise<void> {
  await migrate({
    connectionString: url("skal_migrator", name),
    shadowConnectionString: url("skal_migrator", "schema5_shadow"),
    rootConnectionString: url("postgres", "postgres"),
    migrationsFolder: folder,
  });
}

export async function copyDir(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
}
