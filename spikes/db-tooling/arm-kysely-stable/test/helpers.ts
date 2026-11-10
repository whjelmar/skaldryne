import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Kysely } from "kysely";
import { withTenant, type DB } from "../src/db/index.ts";
import { CONTAINER } from "../src/config.ts";

export interface Seed {
  tenantId: string;
  campaignId: string;
  entityId: string;
  claimId: string;
}

/** Create a tenant with one campaign, one entity and one claim (two versions), as skal_app. */
export async function seedTenant(db: Kysely<DB>, label: string): Promise<Seed> {
  const s: Seed = { tenantId: randomUUID(), campaignId: randomUUID(), entityId: randomUUID(), claimId: randomUUID() };
  await withTenant(db, s.tenantId, async (tx) => {
    await tx.insertInto("tenant").values({ id: s.tenantId, name: label }).execute();
    await tx.insertInto("campaign").values({ tenant_id: s.tenantId, id: s.campaignId, name: `${label} campaign` }).execute();
    await tx
      .insertInto("entity")
      .values({ tenant_id: s.tenantId, id: s.entityId, campaign_id: s.campaignId, kind: "npc", display_name: `${label} npc` })
      .execute();
    await tx
      .insertInto("claim_version")
      .values([1, 2].map((version) => ({
        tenant_id: s.tenantId,
        claim_id: s.claimId,
        version,
        campaign_id: s.campaignId,
        subject_id: s.entityId,
        predicate: "title",
        object: JSON.stringify(`${label} v${version}`),
      })))
      .execute();
  });
  return s;
}

/** Run psql inside the database container (stdin = SQL). */
export function psql(database: string, role: string, sqlText: string, extraArgs: string[] = []): string {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...extraArgs],
    { input: sqlText, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

/** Schema-only dump from inside the container, minus volatile header lines. */
export function schemaDump(database: string): string {
  const out = execFileSync(
    "docker",
    ["exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", database, "--schema-only", "--no-owner", "--restrict-key=spike"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .filter((l) => !l.startsWith("-- Dumped") && !l.startsWith("\\restrict") && !l.startsWith("\\unrestrict"))
    .join("\n");
}
