// Bring every listed database to the latest committed migration, then report its applied state.
// Usage: node scripts/fleet.ts kysely_a kysely_b ...
import { appliedMigrations, migrateDatabase, MIGRATIONS_DIR } from "../src/migrate.ts";

export interface FleetReport {
  database: string;
  /** Hash of the last applied migration. Each hash chains over all previous ones, so it fingerprints the whole history. */
  head: string | null;
  applied: { filename: string; hash: string }[];
}

export async function fleet(databases: string[], migrationsFolder = MIGRATIONS_DIR): Promise<FleetReport[]> {
  const report: FleetReport[] = [];
  for (const database of databases) {
    await migrateDatabase(database, migrationsFolder);
    const applied = (await appliedMigrations(database)).map(({ filename, hash }) => ({ filename, hash }));
    report.push({ database, head: applied.at(-1)?.hash ?? null, applied });
  }
  return report;
}

if (import.meta.main) {
  const report = await fleet(process.argv.slice(2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
