import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAIN_DB } from "../src/config.ts";
import { ARM_DIR, MIGRATIONS_DIR } from "../src/migrate.ts";
import { psql } from "./helpers.ts";

interface SquawkIssue {
  file: string;
  line: number;
  level: string;
  rule_name: string;
  message: string;
}

describe("T8", () => {
  it("T8a squawk runs over the committed migration files, which are exactly the SQL that executes", async () => {
    const files = (await readdir(join(MIGRATIONS_DIR, "committed"))).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toHaveLength(3);
    const args = [
      join(ARM_DIR, "node_modules", "squawk-cli", "js", "bin", "squawk"),
      // graphile-migrate wraps each committed migration in a transaction itself.
      "--assume-in-transaction",
      "--pg-version=18.0",
      "--reporter", "json",
      ...files.map((f) => join("migrations", "committed", f)),
    ];
    let out: string;
    try {
      out = execFileSync(process.execPath, args, { cwd: ARM_DIR, encoding: "utf8" });
    } catch (e) {
      // squawk exits 1 when it reports anything; the JSON is still on stdout.
      out = (e as { stdout: string }).stdout;
    }
    const issues = JSON.parse(out) as SquawkIssue[];
    await mkdir(join(ARM_DIR, "reports"), { recursive: true });
    await writeFile(join(ARM_DIR, "reports", "squawk.json"), JSON.stringify(issues, null, 2) + "\n");

    // No parse errors: every file was understood.
    expect(issues.filter((i) => i.level !== "Warning")).toEqual([]);
    // Pinned, so a change in what squawk flags is visible. Discussed in RESULTS.md.
    const byRule: Record<string, number> = {};
    for (const i of issues) {
      const key = `${i.file.split(/[\\/]/).pop()}: ${i.rule_name}`;
      byRule[key] = (byRule[key] ?? 0) + 1;
    }
    expect(byRule).toMatchSnapshot();
  });

  it("T8b pgTAP: RLS with the tenant_isolation policy on every tenant table", async () => {
    const sqlText = await readFile(join(ARM_DIR, "test", "pgtap", "rls.sql"), "utf8");
    // finish(true) raises if any non-TODO test failed, and ON_ERROR_STOP turns that into a non-zero exit.
    const tap = psql(MAIN_DB, "skal_migrator", sqlText, ["-At"]);
    await writeFile(join(ARM_DIR, "reports", "pgtap-rls.tap"), tap);
    const lines = tap.split(/\r?\n/).filter((l) => /^(not )?ok \d+/.test(l));
    expect(tap).toMatch(/^1\.\.32$/m);
    expect(lines).toHaveLength(32);
    expect(lines.filter((l) => l.startsWith("not ok"))).toEqual([]);
    expect(tap).not.toMatch(/# TODO/); // the partition checks pass outright now that M1 revokes skal_app
  });
});
