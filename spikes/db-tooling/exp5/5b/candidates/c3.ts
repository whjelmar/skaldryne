// C3: run the Vitest file tests/c3.test.ts against one variant and read its JSON report.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run, url, CHECK_ROLE } from "../lib/env.ts";
import { ROOT } from "../lib/databases.ts";
import type { Ctx, Outcome } from "./types.ts";

export async function c3(ctx: Ctx): Promise<Outcome> {
  const report = join(ctx.dir, "c3-report.json");
  const r = await run("node", ["node_modules/vitest/vitest.mjs", "run", "tests/c3.test.ts", "--reporter=json", `--outputFile=${report}`], {
    cwd: ROOT, env: { SCHEMA_DIR: join(ctx.dir, "schema"), DATABASE_URL: url(CHECK_ROLE, ctx.db) },
  });
  let json: any;
  try { json = JSON.parse(await readFile(report, "utf8")); } catch { return { findings: [], error: `no report, exit ${r.code}: ${(r.stdout + r.stderr).slice(-400)}` }; }
  const findings: string[] = [];
  for (const f of json.testResults) {
    if (f.status === "failed" && !f.assertionResults.length) findings.push(`suite error: ${String(f.message).slice(0, 200)}`);
    for (const t of f.assertionResults) if (t.status === "failed") findings.push(`${t.fullName}: ${String(t.failureMessages[0] ?? "").split("\n")[0]}`);
  }
  return { findings: findings.sort(), facts: { exit: r.code, tests: json.numTotalTests, failed: json.numFailedTests } };
}
