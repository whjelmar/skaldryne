// T7: bring every database in a fleet to the latest migration and report what each one has applied.
// Usage: node scripts/fleet.ts drizzle_fleet_a drizzle_fleet_b ...
import { appliedMigrations, migrateDatabase, type AppliedMigration } from '../src/migrations.ts';

export interface FleetReport {
  database: string;
  before: number;
  after: number;
  head: string | null;
  // A single comparable value per database: hash of the ordered (name, hash) list.
  fingerprint: string;
  applied: AppliedMigration[];
}

async function fingerprintOf(applied: AppliedMigration[]): Promise<string> {
  const text = applied.map((m) => `${m.name}:${m.hash}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex').slice(0, 16);
}

export async function migrateFleet(databases: string[]): Promise<FleetReport[]> {
  const reports: FleetReport[] = [];
  for (const database of databases) {
    const before = await appliedMigrations(database);
    await migrateDatabase(database);
    const applied = await appliedMigrations(database);
    reports.push({
      database,
      before: before.length,
      after: applied.length,
      head: applied.at(-1)?.name ?? null,
      fingerprint: await fingerprintOf(applied),
      applied,
    });
  }
  return reports;
}

export function formatReport(reports: FleetReport[]): string {
  return reports
    .map((r) => `${r.database}: ${r.before} -> ${r.after} applied, head=${r.head}, fingerprint=${r.fingerprint}`)
    .join('\n');
}

if (import.meta.main) {
  const databases = process.argv.slice(2);
  if (databases.length === 0) throw new Error('usage: node scripts/fleet.ts <database>...');
  console.log(formatReport(await migrateFleet(databases)));
}
