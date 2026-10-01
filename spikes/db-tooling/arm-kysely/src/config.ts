// Connection settings for the spike's local Postgres (see ../README.md). Overridable by env.
export const PG_HOST = process.env.PGHOST ?? "localhost";
export const PG_PORT = Number(process.env.PGPORT ?? 55432);
export const CONTAINER = process.env.DB_CONTAINER ?? "db-tooling-db-1";

export const MAIN_DB = "kysely_main";
export const SHADOW_DB = "kysely_shadow";

export type Role = "postgres" | "skal_migrator" | "skal_app";
const PASSWORDS: Record<Role, string> = {
  postgres: "postgres",
  skal_migrator: "migrator",
  skal_app: "app",
};

export function url(role: Role, database: string): string {
  if (!database.startsWith("kysely_") && database !== "postgres") {
    throw new Error(`refusing to touch database outside the kysely_ prefix: ${database}`);
  }
  return `postgres://${role}:${PASSWORDS[role]}@${PG_HOST}:${PG_PORT}/${database}`;
}
