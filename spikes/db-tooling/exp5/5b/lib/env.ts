// Connection settings, prefix guard and small process helpers for experiment 5b.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const PG_HOST = process.env.PGHOST ?? "localhost";
export const PG_PORT = Number(process.env.PGPORT ?? 55432);
const PASSWORDS = { postgres: "postgres", skal_migrator: "migrator", skal_app: "app" } as const;
export type Role = keyof typeof PASSWORDS;

/** Every database this experiment touches starts with schema5_ (or is the postgres maintenance db). */
export function url(role: Role, database: string): string {
  if (!database.startsWith("schema5_") && database !== "postgres") {
    throw new Error(`refusing to touch database outside the schema5_ prefix: ${database}`);
  }
  return `postgres://${role}:${PASSWORDS[role]}@${PG_HOST}:${PG_PORT}/${database}`;
}

export async function withClient<T>(role: Role, database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url(role, database) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Run a command with stdin closed (no prompts can be answered), capture output, and time it. */
export function run(cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number }): Promise<RunResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => p.kill(), opts.timeoutMs ?? 120_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Math.round(performance.now() - t0) });
    });
  });
}

export const DRIZZLE_KIT = [fileURLToPath(new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url))];

/** Role the checks connect as. Default is the migrator; set CHECK_ROLE=skal_app to see what a least-privilege role can do. */
export const CHECK_ROLE: Role = (process.env.CHECK_ROLE as Role | undefined) ?? "skal_migrator";
