// Superuser bootstrap: recreate kysely_main and kysely_shadow (owned by skal_migrator, with
// extensions), then apply every committed migration to kysely_main with graphile-migrate.
// Usage: node scripts/bootstrap.ts [--no-migrate]
import { bootstrapDatabase, migrateDatabase } from "../src/migrate.ts";
import { MAIN_DB, SHADOW_DB } from "../src/config.ts";

export async function bootstrap(opts: { migrate: boolean } = { migrate: true }): Promise<void> {
  await bootstrapDatabase(MAIN_DB);
  await bootstrapDatabase(SHADOW_DB);
  if (opts.migrate) await migrateDatabase(MAIN_DB);
}

if (import.meta.main) {
  await bootstrap({ migrate: !process.argv.includes("--no-migrate") });
}
