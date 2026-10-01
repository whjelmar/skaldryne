import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appUrl, migratorUrl } from "../scripts/bootstrap.ts";
import { createDb, withTenant, type Db } from "../src/db.ts";

export const MAIN_DB = "prisma_main";
export const CONTAINER = "db-tooling-db-1";

export const app = (db = MAIN_DB, max = 1) => createDb(appUrl(db), { max });
export const migrator = (db = MAIN_DB, max = 1) => createDb(migratorUrl(db), { max });

export interface Seed { tenantId: string; campaignId: string; entityId: string; claimId: string }

/** A tenant with one campaign, one entity and one claim in two versions, written as skal_app through the ORM. */
export async function seedTenant(db: Db, label: string): Promise<Seed> {
  const s: Seed = { tenantId: randomUUID(), campaignId: randomUUID(), entityId: randomUUID(), claimId: randomUUID() };
  await withTenant(db, s.tenantId, async (tx) => {
    await tx.orm.public.Tenant.create({ id: s.tenantId, name: label });
    await tx.orm.public.Campaign.create({ tenantId: s.tenantId, id: s.campaignId, name: `${label} campaign` });
    await tx.orm.public.Entity.create({
      tenantId: s.tenantId, id: s.entityId, campaignId: s.campaignId, kind: "npc", displayName: `${label} npc`,
    });
    for (const version of [1, 2]) {
      await tx.orm.public.ClaimVersion.create({
        tenantId: s.tenantId, claimId: s.claimId, version, campaignId: s.campaignId, subjectId: s.entityId,
        predicate: "title", object: `${label} v${version}`,
      });
    }
  });
  return s;
}

/** psql inside the database container; SQL on stdin. */
export function psql(db: string, user: string, sql: string, extra: string[] = []): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", ...extra], {
    input: sql,
    encoding: "utf8",
  });
}

/** The Postgres error behind a rejected promise: the runtime wraps it, so walk the cause chain. */
export async function pgError(p: Promise<unknown>): Promise<{ message: string; code?: string; chain: string }> {
  try {
    await p;
  } catch (e) {
    const chain: string[] = [];
    let cur: any = e;
    let code: string | undefined;
    let message = (e as Error).message;
    while (cur) {
      chain.push(`${cur.code ?? ""} ${cur.message ?? ""}`.trim());
      if (typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) { code ??= cur.code; message = cur.message; }
      const sqlState = cur.meta?.sqlState ?? cur.sqlState;
      if (typeof sqlState === "string") { code ??= sqlState; }
      cur = cur.cause;
    }
    return { message, code, chain: chain.join(" <- ") };
  }
  throw new Error("expected the operation to fail, but it succeeded");
}
