// T7: bring every database in a fleet to the head contract with one command, and report each one's state.
// State is the content hash of the contract a database satisfies, read from prisma_contract.marker
// (one row per space). The same contract gives the same hash in every database, so a fleet compares by
// grouping on that hash; ledger rows add which migrations got it there.
//
// Usage: node scripts/fleet.ts prisma_fleet_a prisma_fleet_b ...
import pg from "pg";
import { migratorUrl } from "./bootstrap.ts";
import { prisma } from "./prisma-cli.ts";

const NAMES: Record<string, string> = {
  b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512: "M1",
  d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab: "M2",
  "0a97774db46f16854da8341479383b568b4b3b2d0196b0c5f73a461f48f9ae4c": "M3",
};

export interface DbState { db: string; app: string | null; label: string; pgvector: string | null; ledgerRows: number }

export async function readState(db: string): Promise<DbState> {
  const client = new pg.Client({ connectionString: migratorUrl(db) });
  await client.connect();
  try {
    const marker = await client.query<{ space: string; core_hash: string }>("SELECT space, core_hash FROM prisma_contract.marker");
    const ledger = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM prisma_contract.ledger");
    const app = marker.rows.find((r) => r.space === "app")?.core_hash ?? null;
    return {
      db,
      app,
      label: app ? NAMES[app] ?? "unknown" : "empty",
      pgvector: marker.rows.find((r) => r.space === "pgvector")?.core_hash ?? null,
      ledgerRows: ledger.rows[0]?.n ?? 0,
    };
  } finally {
    await client.end();
  }
}

export interface FleetRow { db: string; before: DbState; after: DbState; applied: number; ok: boolean; summary: string }

export async function migrateFleet(dbs: string[]): Promise<FleetRow[]> {
  const rows: FleetRow[] = [];
  for (const db of dbs) {
    if (!db.startsWith("prisma_")) throw new Error(`refusing to touch database ${db}`);
    const before = await readState(db);
    const r = prisma(["db", "migrate", "--db", migratorUrl(db)]);
    const res = (r.envelope?.result ?? r.envelope ?? {}) as { ok?: boolean; migrationsApplied?: number; summary?: string };
    const after = await readState(db);
    rows.push({ db, before, after, applied: res.migrationsApplied ?? -1, ok: r.exitCode === 0 && res.ok !== false, summary: res.summary ?? r.stderr.slice(0, 300) });
  }
  return rows;
}

export function report(rows: FleetRow[]): string {
  const lines = rows.map((r) =>
    `${r.db.padEnd(18)} ${r.before.label.padEnd(5)} -> ${r.after.label.padEnd(5)} applied=${r.applied} ok=${r.ok} app=${r.after.app?.slice(0, 12)} pgvector=${r.after.pgvector?.slice(0, 12)} ledger=${r.after.ledgerRows}  ${r.summary}`,
  );
  const byHash = new Map<string, string[]>();
  for (const r of rows) byHash.set(r.after.label, [...(byHash.get(r.after.label) ?? []), r.db]);
  lines.push(`fleet by contract: ${[...byHash].map(([k, v]) => `${k}: ${v.length}`).join(", ")}`);
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("fleet.ts")) {
  console.log(report(await migrateFleet(process.argv.slice(2))));
}
