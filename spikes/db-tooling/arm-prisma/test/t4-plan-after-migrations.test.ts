import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { migratorUrl } from "../scripts/bootstrap.ts";
import { ARM_DIR, prisma } from "../scripts/prisma-cli.ts";
import { withTenant } from "../src/db.ts";
import { app, MAIN_DB, seedTenant } from "./helpers.ts";

const { db, close } = app();
afterAll(close);

describe("T4 the tool's plan and diff after M1-M3", () => {
  it("migration plan proposes no operations", () => {
    const before = readdirSync(join(ARM_DIR, "migrations", "app"));
    const r = prisma(["migration", "plan", "--name", "t4probe"]);
    console.log("T4 migration plan:", JSON.stringify(r.envelope));
    expect(r.exitCode).toBe(0);
    expect(r.envelope?.ok).toBe(true);
    const result = (r.envelope?.result ?? r.envelope) as { noOp?: boolean; operations?: unknown[] };
    expect(result.noOp).toBe(true);
    expect(result.operations).toEqual([]);
    // No migration directory is written for a no-op plan.
    expect(readdirSync(join(ARM_DIR, "migrations", "app"))).toEqual(before);
    expect(existsSync(join(ARM_DIR, "migrations", "app", "t4probe"))).toBe(false);
  });

  it("db verify (the live-database diff) flags nothing for triggers, functions, partitions or HNSW, but flags the policies (RC bug)", () => {
    const r = prisma(["db", "verify", "--db", migratorUrl(MAIN_DB)]);
    const result = r.envelope?.result as { ok: boolean; summary: string; schema?: { issues: { path: string[]; actual?: { nodeKind?: string } }[] } };
    const issues = result.schema?.issues ?? [];
    console.log(`T4 db verify: exit ${r.exitCode}; ${result.summary}`);
    for (const i of issues) console.log(`  ${i.path.join(".")} (${i.actual?.nodeKind ?? "?"})`);
    const text = JSON.stringify(issues);
    for (const word of ["trigger", "function", "claim_version_p", "hnsw", "append_only", "claim_current_sync"]) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
    // Recorded as found, not as desired: the nine tenant_isolation policies, which the contract declares,
    // are reported as unexpected. See RESULTS.md (verify drops the app space's policies when an
    // extension space is present).
    expect(issues.map((i) => i.actual?.nodeKind)).toEqual(Array(9).fill("postgres-policy"));
    expect(result.ok).toBe(false);
  });

  it("db verify --strict additionally reports the raw-SQL HNSW index as extra", () => {
    const r = prisma(["db", "verify", "--strict", "--db", migratorUrl(MAIN_DB)]);
    const result = r.envelope?.result as { summary: string; schema?: { issues: { path: string[] }[] } };
    console.log(`T4 db verify --strict: exit ${r.exitCode}; ${result.summary}`);
    const paths = (result.schema?.issues ?? []).map((i) => i.path.join("."));
    expect(paths.some((p) => p.includes("claim_embedding_hnsw"))).toBe(true);
  });

  it("claim versions still update claim_current through the trigger, and reads are typed", async () => {
    const s = await seedTenant(db, "T4");
    const current = await withTenant(db, s.tenantId, async (tx) => {
      await tx.orm.public.ClaimVersion.create({
        tenantId: s.tenantId, claimId: s.claimId, version: 3, campaignId: s.campaignId, subjectId: s.entityId,
        predicate: "title", object: { title: "T4 v3" },
      });
      return tx.orm.public.ClaimCurrent.where({ claimId: s.claimId }).first();
    });
    expect(current?.version).toBe(3);
    expect(current?.object).toEqual({ title: "T4 v3" });
    expectTypeOf(current!.version).toEqualTypeOf<number>();
    expectTypeOf(current!.claimId).toEqualTypeOf<string>();
    // claim_version stays append-only.
    await expect(
      withTenant(db, s.tenantId, (tx) => tx.orm.public.ClaimVersion.where({ claimId: s.claimId }).deleteAll()),
    ).rejects.toThrow();
  });
});
