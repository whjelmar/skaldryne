import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSql } from "../scripts/extract-sql.ts";
import { ARM_DIR } from "../scripts/prisma-cli.ts";
import { MAIN_DB, psql } from "./helpers.ts";

describe("T8a squawk over the executed SQL", () => {
  it("lints the SQL extracted from ops.json and records what it flags", () => {
    const files = extractSql();
    expect(files).toHaveLength(3);
    const r = spawnSync(process.execPath, [
      join(ARM_DIR, "node_modules", "squawk-cli", "js", "bin", "squawk"),
      "--assume-in-transaction", "--pg-version=18.0", "--reporter", "json", ...files,
    ], { cwd: ARM_DIR, encoding: "utf8" });
    writeFileSync(join(ARM_DIR, "reports", "squawk.json"), r.stdout);
    const findings = JSON.parse(r.stdout || "[]") as { file: string; rule_name: string; level: string; line: number }[];
    const byRule = new Map<string, number>();
    for (const f of findings) {
      const key = `${basename(f.file)} ${f.rule_name} (${f.level})`;
      byRule.set(key, (byRule.get(key) ?? 0) + 1);
    }
    console.log(`T8a squawk exit ${r.status}, ${findings.length} findings:\n` + [...byRule].map(([k, n]) => `  ${n} x ${k}`).join("\n"));
    expect(r.stderr).not.toMatch(/error: /i);
    // squawk ran over all three migrations (it exits 1 when it finds anything).
    expect([0, 1]).toContain(r.status);
  });
});

describe("T8b pgTAP", () => {
  it("RLS is enabled with the tenant_isolation policy on every tenant table", () => {
    const tap = psql(MAIN_DB, "postgres", readFileSync(join(ARM_DIR, "test", "pgtap", "rls.sql"), "utf8"), ["-At"]);
    const top = tap.split("\n").filter((l) => /^(not )?ok \d+/.test(l));
    console.log("T8b pgTAP:\n" + top.join("\n"));
    expect(top).toHaveLength(5);
    expect(tap).not.toMatch(/not ok/);
    const assertions = tap.split("\n").filter((l) => /^ {4}ok \d+/.test(l)).length;
    expect(assertions).toBe(62);
  });
});
