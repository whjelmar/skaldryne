// Recreates prisma_main and applies M1 to M3 with the prisma CLI, so `pnpm test` starts clean.
import { migratorUrl, recreateDatabase } from "../scripts/bootstrap.ts";
import { prisma } from "../scripts/prisma-cli.ts";

export default async function setup() {
  await recreateDatabase("prisma_main");
  const r = prisma(["db", "migrate", "--db", migratorUrl("prisma_main")]);
  if (r.exitCode !== 0 || !r.envelope?.ok) {
    throw new Error(`db migrate failed (${r.exitCode}): ${JSON.stringify(r.envelope ?? r.stderr).slice(0, 2000)}`);
  }
}
