// Connection settings for the spike's local Postgres (see ../README.md). Overridable by env.
export const PG_HOST = process.env.PGHOST ?? "localhost";
export const PG_PORT = Number(process.env.PGPORT ?? 55432);
export const CONTAINER = process.env.DB_CONTAINER ?? "db-tooling-db-1";

export const MAIN_DB = "kysely14_main";
export const SHADOW_DB = "kysely14_shadow";

export type Role = "postgres" | "skal_migrator" | "skal_app";
const PASSWORDS: Record<Role, string> = {
  postgres: "postgres",
  skal_migrator: "migrator",
  skal_app: "app",
};

export const EXP1_DB = "exp1_kysely"; // Experiment 1 copy of the exp1_main template

export function url(role: Role, database: string): string {
  if (!database.startsWith("kysely14_") && database !== "postgres" && database !== EXP1_DB) {
    throw new Error(`refusing to touch database outside the kysely14_ prefix (or exp1_kysely): ${database}`);
  }
  return `postgres://${role}:${PASSWORDS[role]}@${PG_HOST}:${PG_PORT}/${database}`;
}
