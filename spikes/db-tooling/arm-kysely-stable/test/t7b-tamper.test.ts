// T7 tamper check for graphile-migrate 1.4.1. Records, empirically, which kinds of tampering `migrate` detects.
import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapDatabase } from "../src/migrate.ts";
import { appliedFiles, committedFiles, makeNote, root, runGm, scratchFolder, writeConfig } from "./gm-cli.ts";

const note = makeNote("exp2-t7-tamper.log");

async function upToDate(db: string, name: string) {
  await bootstrapDatabase(db);
  const folder = await scratchFolder(name);
  const cfg = await writeConfig(folder, db);
  const r = await runGm(cfg, ["migrate"]);
  expect(r.code, r.out).toBe(0);
  return { folder, cfg };
}

describe("T7 tamper (graphile-migrate 1.4.1)", () => {
  it("(a) tampered hash in the graphile_migrate.migrations table is not detected", async () => {
    const db = "kysely14_tamper_a";
    const { cfg } = await upToDate(db, "tamper-a");
    await root((c) => c.query("update graphile_migrate.migrations set hash = 'sha1:tampered' where filename = '000003.sql'"), db);
    const r = await runGm(cfg, ["migrate"]);
    note("[a] table hash tampered, migrate\ncode=" + r.code + "\n" + r.out);
    expect(r.code).toBe(0);
  });

  it("(b) editing an already-applied committed file is not detected on an up-to-date database", async () => {
    const db = "kysely14_tamper_b";
    const { folder, cfg } = await upToDate(db, "tamper-b");
    const f = join(folder, "committed", (await committedFiles(folder))[1]!);
    await writeFile(f, (await readFile(f, "utf8")) + "\n-- tampered after apply\nSELECT 1;\n");
    const r = await runGm(cfg, ["migrate"]);
    note("[b] applied file edited, migrate\ncode=" + r.code + "\n" + r.out);
    expect(r.code).toBe(0);
    expect(await appliedFiles(db)).toHaveLength(3);
  });

  it("(c) editing a pending (not yet applied) committed file IS detected", async () => {
    const db = "kysely14_tamper_c";
    await bootstrapDatabase(db);
    const folder = await scratchFolder("tamper-c");
    const cfg = await writeConfig(folder, db);
    const f = join(folder, "committed", (await committedFiles(folder))[1]!);
    await writeFile(f, (await readFile(f, "utf8")) + "\n-- tampered before apply\nSELECT 1;\n");
    const r = await runGm(cfg, ["migrate"]);
    note("[c] pending file edited, migrate\ncode=" + r.code + "\n" + r.out);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/tampered/i);
  });
});
