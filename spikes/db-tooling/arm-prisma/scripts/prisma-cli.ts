// Runs the prisma CLI as a child process and returns its final NDJSON result envelope.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ARM_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ARM_DIR, "node_modules", "prisma", "dist", "prisma.js");

export interface CliResult {
  exitCode: number;
  /** The `envelope` of the `"kind":"result"` line, or undefined if the CLI printed none. */
  envelope: { ok: boolean; result?: any; code?: string; summary?: string; why?: string; [k: string]: unknown } | undefined;
  stdout: string;
  stderr: string;
}

export function prisma(args: string[]): CliResult {
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], {
    cwd: ARM_DIR,
    encoding: "utf8",
    env: { ...process.env, DO_NOT_TRACK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
  const lines = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => l.includes('"kind":"result"'));
  const last = lines.at(-1);
  return {
    exitCode: r.status ?? -1,
    envelope: last ? JSON.parse(last).envelope : undefined,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}
