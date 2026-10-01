// T8a: the CLI keeps no SQL files. Each migration's executed SQL lives in its ops.json, as execute[].sql
// per operation (prechecks and postchecks are read-only probes and are left out). This writes one
// .sql file per migration under reports/sql/ for linters such as squawk.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARM_DIR } from "./prisma-cli.ts";

interface Op { id: string; label: string; execute: { description: string; sql: string; params?: unknown[] }[] }

export function extractSql(outDir = join(ARM_DIR, "reports", "sql")): string[] {
  mkdirSync(outDir, { recursive: true });
  const appDir = join(ARM_DIR, "migrations", "app");
  const written: string[] = [];
  for (const name of readdirSync(appDir).filter((d) => /^\d{8}T\d{4}_/.test(d)).sort()) {
    const ops = JSON.parse(readFileSync(join(appDir, name, "ops.json"), "utf8")) as Op[];
    const body = ops
      .flatMap((op) => op.execute.map((e) => `-- ${op.id}: ${e.description}\n${e.sql.trim().replace(/;$/, "")};\n`))
      .join("\n");
    const file = join(outDir, `${name}.sql`);
    writeFileSync(file, `-- Extracted from migrations/app/${name}/ops.json by scripts/extract-sql.ts\n\n${body}`);
    written.push(file);
  }
  return written;
}

if (process.argv[1]?.endsWith("extract-sql.ts")) {
  for (const f of extractSql()) console.log(f);
}
