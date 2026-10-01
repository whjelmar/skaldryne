import "dotenv/config";
import { definePrismaConfig } from "prisma/config";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";
import pgvector from "@prisma/orm-extension-pgvector/control";

// Migrations run as skal_migrator. Commands that target another database pass --db.
export default definePrismaConfig({
  orm: ormConfig({
    contract: "./prisma/contract.prisma",
    extensions: [pgvector],
    db: { connection: process.env["DATABASE_URL"] ?? "postgresql://skal_migrator:migrator@localhost:55432/prisma_main" },
  }),
  skills: { check: false },
});
