import { createHash, randomUUID } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migratorUrl, recreateDatabase } from "../scripts/bootstrap.ts";
import { ARM_DIR, prisma } from "../scripts/prisma-cli.ts";
import { withTenant, type Tx } from "../src/db.ts";
import { app, MAIN_DB, psql } from "./helpers.ts";

const T6_DB = "prisma_t6";
const WORK = join(ARM_DIR, "t6-work");
const M2_DIR = join(WORK, "migrations", "app", "20261001T0451_m2");
const CONFIG = ["--config", "t6-work/prisma.config.ts"];
const result = (r: ReturnType<typeof prisma>) => (r.envelope?.result ?? r.envelope ?? {}) as Record<string, any>;

describe("T6a re-applying migrations", () => {
  it("is a no-op on a database already at M3", () => {
    const r = prisma(["db", "migrate", "--db", migratorUrl(MAIN_DB)]);
    console.log("T6a:", JSON.stringify(result(r)));
    expect(r.exitCode).toBe(0);
    expect(result(r).migrationsApplied).toBe(0);
  });
});

describe("T6b a broken M2", () => {
  const schemaState = () =>
    psql(T6_DB, "postgres", `
      SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'entity' AND column_name = 'display_name') AS has_display_name,
             (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'entity' AND column_name = 'name') AS name_nullable,
             (SELECT count(*) FROM pg_trigger WHERE tgname = 'entity_name_sync') AS sync_trigger,
             (SELECT count(*) FROM pg_proc WHERE proname = 'entity_name_sync') AS sync_function,
             (SELECT core_hash FROM prisma_contract.marker WHERE space = 'app') AS marker,
             (SELECT count(*) FROM prisma_contract.ledger WHERE space = 'app') AS ledger`, ["-At"]).trim();

  beforeAll(async () => {
    rmSync(WORK, { recursive: true, force: true });
    cpSync(join(ARM_DIR, "migrations"), join(WORK, "migrations"), { recursive: true });
    writeFileSync(join(WORK, "prisma.config.ts"), [
      `import { definePrismaConfig } from "prisma/config";`,
      `import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";`,
      `import pgvector from "@prisma/orm-extension-pgvector/control";`,
      `export default definePrismaConfig({`,
      // Paths in a config resolve relative to the config file, not the working directory.
      `  orm: ormConfig({ contract: "../prisma/contract.prisma", extensions: [pgvector], migrations: { dir: "./migrations" } }),`,
      `  skills: { check: false },`,
      `});`,
    ].join("\n"));
    // Break M2 in the copy: its third operation (the sync trigger) points at a function that does not
    // exist, so addColumn and dropNotNull run first and the migration fails partway. Re-emit ops.json.
    const ts = join(M2_DIR, "migration.ts");
    writeFileSync(ts, readFileSync(ts, "utf8")
      .replace("../../../scripts/raw-op.ts", "../../../../scripts/raw-op.ts")
      .replace("FOR EACH ROW EXECUTE FUNCTION public.entity_name_sync()", "FOR EACH ROW EXECUTE FUNCTION public.no_such_function()"));
    const emit = spawnSync(process.execPath, [ts, ...CONFIG], { cwd: ARM_DIR, encoding: "utf8" });
    if (emit.status !== 0) throw new Error(`re-emit of broken M2 failed: ${emit.stderr}`);
    if (!readFileSync(join(M2_DIR, "ops.json"), "utf8").includes("no_such_function")) throw new Error("broken M2 was not re-emitted");

    await recreateDatabase(T6_DB);
    const m1 = prisma(["db", "migrate", ...CONFIG, "--db", migratorUrl(T6_DB), "--to", "m1"]);
    if (m1.exitCode !== 0) throw new Error(`T6b setup to m1: ${JSON.stringify(m1.envelope)}`);
    psql(T6_DB, "skal_migrator", `
      INSERT INTO tenant (id, name) VALUES ('0199a000-0000-7000-8000-000000000001', 'T6');
      INSERT INTO campaign (tenant_id, id, name) VALUES ('0199a000-0000-7000-8000-000000000001', '0199a000-0000-7000-8000-000000000002', 'c');
      INSERT INTO entity (tenant_id, id, campaign_id, kind, name)
        VALUES ('0199a000-0000-7000-8000-000000000001', '0199a000-0000-7000-8000-000000000003', '0199a000-0000-7000-8000-000000000002', 'npc', 'Old name');`);
  });
  afterAll(() => rmSync(WORK, { recursive: true, force: true }));

  it("fails partway and leaves the database exactly at M1", () => {
    const before = schemaState();
    const r = prisma(["db", "migrate", ...CONFIG, "--db", migratorUrl(T6_DB), "--to", "m2"]);
    console.log(`T6b broken M2: exit ${r.exitCode}\n${JSON.stringify(r.envelope).slice(0, 1500)}`);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.stringify(r.envelope)).toMatch(/no_such_function/);
    const after = schemaState();
    console.log(`T6b state before: ${before}\nT6b state after:  ${after}`);
    expect(after).toBe(before);
    expect(after.startsWith("0|NO|0|0|b4c11737")).toBe(true);
  });

  it("completes once fixed, and the backfill ran", () => {
    rmSync(M2_DIR, { recursive: true, force: true });
    cpSync(join(ARM_DIR, "migrations", "app", "20261001T0451_m2"), M2_DIR, { recursive: true });
    const r = prisma(["db", "migrate", ...CONFIG, "--db", migratorUrl(T6_DB), "--to", "m2"]);
    console.log("T6b fixed M2:", JSON.stringify(result(r)));
    expect(r.exitCode).toBe(0);
    expect(result(r).migrationsApplied).toBe(1);
    expect(schemaState().startsWith("1|YES|1|1|d2b00090")).toBe(true);
    expect(psql(T6_DB, "postgres", "SELECT display_name FROM entity", ["-At"]).trim()).toBe("Old name");
  });
});

describe("T6c importing the same 50 entities twice", () => {
  const { db, close } = app();
  const tenantId = randomUUID();
  const campaignId = randomUUID();
  const SOURCE = "t6-fixture";
  afterAll(close);

  const records = Array.from({ length: 50 }, (_, i) => ({
    key: `npc-${i}`,
    name: `Imported NPC ${i}`,
    claims: [
      { predicate: "title", object: `title ${i}` as unknown },
      { predicate: "home", object: { town: `town ${i % 7}` } as unknown },
    ],
  }));
  type Rec = (typeof records)[number];
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  /** A stable uuid per (source key, predicate), so a re-import addresses the same claim. */
  const claimIdFor = (key: string, predicate: string) => {
    const h = sha(`${SOURCE}/${key}/${predicate}`);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };

  /** Upsert keyed on import_record (tenant_id, source, source_key); content_hash decides whether anything changed. */
  async function importOne(tx: Tx, r: Rec): Promise<"created" | "updated" | "unchanged"> {
    const contentHash = sha(JSON.stringify(r));
    const existing = await tx.orm.public.ImportRecord.where({ tenantId, source: SOURCE, sourceKey: r.key }).first();
    if (existing?.contentHash === contentHash) return "unchanged";
    const entityId = existing?.entityId ?? randomUUID();
    if (!existing) {
      await tx.orm.public.Entity.create({ tenantId, id: entityId, campaignId, kind: "npc", displayName: r.name });
    } else {
      await tx.orm.public.Entity.where({ tenantId, id: entityId }).updateAll({ displayName: r.name });
    }
    for (const c of r.claims) {
      const claimId = claimIdFor(r.key, c.predicate);
      const current = await tx.orm.public.ClaimCurrent.where({ tenantId, claimId }).first();
      if (current && JSON.stringify(current.object) === JSON.stringify(c.object)) continue;
      await tx.orm.public.ClaimVersion.create({
        tenantId, claimId, version: (current?.version ?? 0) + 1, campaignId, subjectId: entityId,
        predicate: c.predicate, object: c.object as never,
      });
    }
    await tx.orm.public.ImportRecord.where({ tenantId, source: SOURCE, sourceKey: r.key }).upsert({
      create: { tenantId, source: SOURCE, sourceKey: r.key, entityId, contentHash },
      update: { contentHash },
    });
    return existing ? "updated" : "created";
  }

  const runImport = (rs: Rec[]) =>
    withTenant(db, tenantId, async (tx) => {
      const tally = { created: 0, updated: 0, unchanged: 0 };
      for (const r of rs) tally[await importOne(tx, r)]++;
      return tally;
    });
  const counts = () =>
    withTenant(db, tenantId, async (tx) => ({
      entity: (await tx.orm.public.Entity.all()).length,
      claimVersion: (await tx.orm.public.ClaimVersion.all()).length,
      claimCurrent: (await tx.orm.public.ClaimCurrent.all()).length,
      importRecord: (await tx.orm.public.ImportRecord.all()).length,
    }));

  beforeAll(async () => {
    await withTenant(db, tenantId, async (tx) => {
      await tx.orm.public.Tenant.create({ id: tenantId, name: "T6c" });
      await tx.orm.public.Campaign.create({ tenantId, id: campaignId, name: "T6c campaign" });
    });
  });

  it("the second run adds no rows", async () => {
    expect(await runImport(records)).toEqual({ created: 50, updated: 0, unchanged: 0 });
    const first = await counts();
    expect(first).toEqual({ entity: 50, claimVersion: 100, claimCurrent: 100, importRecord: 50 });
    expect(await runImport(records)).toEqual({ created: 0, updated: 0, unchanged: 50 });
    expect(await counts()).toEqual(first);
  });

  it("a changed record updates in place and appends one claim version", async () => {
    const changed = records.map((r, i) =>
      i === 7 ? { ...r, claims: [r.claims[0]!, { predicate: "home", object: { town: "moved" } as unknown }] } : r,
    );
    expect(await runImport(changed)).toEqual({ created: 0, updated: 1, unchanged: 49 });
    expect(await counts()).toEqual({ entity: 50, claimVersion: 101, claimCurrent: 100, importRecord: 50 });
  });
});
