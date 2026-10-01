import { definePrismaConfig } from "prisma/config";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";
import pgvector from "@prisma/orm-extension-pgvector/control";
const withPgvector = process.env["PROBE_PGVECTOR"] === "1";
export default definePrismaConfig({
  orm: ormConfig({
    contract: "./contract.prisma",
    extensions: withPgvector ? [pgvector] : [],
    db: { connection: "postgresql://skal_migrator:migrator@localhost:55432/prisma_probe" },
  }),
  skills: { check: false },
});
