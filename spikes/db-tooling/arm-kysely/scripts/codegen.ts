// Generate Kysely types from a live database with kysely-codegen.
// Usage: node scripts/codegen.ts [database=kysely_main] [outFile=src/db/types.ts] [--verify|--print]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ARM_DIR } from "../src/migrate.ts";
import { url, MAIN_DB } from "../src/config.ts";

const CLI = join(ARM_DIR, "node_modules", "kysely-codegen", "dist", "cli", "bin.js");

export function codegen(
  database = MAIN_DB,
  outFile = "src/db/types.ts",
  mode: "write" | "verify" | "print" = "write",
  overrides?: Record<string, string>,
): string {
  const args = [
    CLI,
    "--dialect", "postgres",
    "--url", url("skal_migrator", database),
    "--include-pattern", "public.*", // app schema only (tap views are visible to skal_migrator)
    "--out-file", join(ARM_DIR, outFile),
    "--log-level", "error",
  ];
  if (overrides) args.push("--overrides", JSON.stringify({ columns: overrides }));
  if (mode === "verify") args.push("--verify");
  if (mode === "print") args.push("--print");
  // execFileSync throws on non-zero exit (e.g. --verify finding drift); callers inspect the error.
  return execFileSync(process.execPath, args, { cwd: ARM_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (import.meta.main) {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const mode = process.argv.includes("--verify") ? "verify" : process.argv.includes("--print") ? "print" : "write";
  const ov = process.argv.find((a) => a.startsWith("--overrides="));
  process.stdout.write(codegen(pos[0], pos[1], mode, ov ? JSON.parse(ov.slice("--overrides=".length)) : undefined));
}
