// C4: `drizzle-kit push --verbose --strict` against the migrated database, with stdin closed. drizzle-kit 0.31.11
// has no dry-run flag. Without --strict and without a TTY it goes on to execute the statements; with --strict it
// prints them and then stops at the confirmation prompt ("Interactive prompts require a TTY"). Exit code is 0 in
// both cases, so the verdict comes from parsing the printed statements. The database is snapshotted before and after.
import { run, url, withClient, CHECK_ROLE, DRIZZLE_KIT } from "../lib/env.ts";
import { catalogSnapshot } from "../lib/catalog.ts";
import { uniq } from "../lib/canon.ts";
import type { Ctx, Outcome } from "./types.ts";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export async function c4(ctx: Ctx): Promise<Outcome> {
  const before = await withClient(CHECK_ROLE, ctx.db, catalogSnapshot);
  const r = await run("node", [...DRIZZLE_KIT, "push", "--config", "drizzle.config.ts", "--verbose", "--strict"], {
    cwd: ctx.dir, env: { DATABASE_URL: url(CHECK_ROLE, ctx.db) },
  });
  const after = await withClient(CHECK_ROLE, ctx.db, catalogSnapshot);
  const text = (r.stdout + r.stderr).replace(ANSI, "");
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const marker = text.indexOf("You are about to execute current statements:");
  if (marker < 0 && /Interactive prompts require a TTY/.test(text)) {
    // drizzle-kit asks "renamed or new?" before it can list statements; with no TTY it errors out. The gate still fails.
    const where = /at (prompt\w+)/.exec(text)?.[1] ?? "prompt";
    return { findings: [`blocked before listing statements: rename prompt (${where})`], facts: { exit: r.code, unchanged, promptBlocked: true } };
  }
  if (marker < 0) {
    const clean = /No changes detected/i.test(text);
    return { findings: [], error: clean ? undefined : `no statement list and no 'No changes detected': ${text.slice(-300)}`, facts: { exit: r.code, unchanged } };
  }
  const block = text.slice(marker).split(/\r?\n/).slice(1);
  const end = block.findIndex((l) => /^Error:/.test(l));
  // Statements are separated by blank lines or end in ';'. One finding per line, minus syntax noise.
  const lines = block.slice(0, end < 0 ? undefined : end).map((l) => l.trim()).filter((l) => l && !l.startsWith("-->"));
  const all = uniq(lines);
  const findings = dropPkeyChurn(all);
  return { findings, facts: { exit: r.code, unchanged, rawCount: all.length, pkeyChurnRemoved: all.length - findings.length, stoppedAtPrompt: /Interactive prompts require a TTY/.test(text) } };
}

/**
 * pull reads primary keys back in a row order that is not stable between runs, so push sometimes proposes
 * "DROP CONSTRAINT x" plus "ADD CONSTRAINT x PRIMARY KEY(...)" for the same key with nothing changed.
 * Drop such same-name pairs. A real primary key change that keeps its name and columns' set but reorders them is hidden by this.
 */
export function dropPkeyChurn(lines: string[]): string[] {
  const key = (l: string) => /^ALTER TABLE ("[^"]+") (?:ADD|DROP) CONSTRAINT ("[^"]+")/.exec(l)?.slice(1).join(" ");
  const added = new Set(lines.filter((l) => / ADD CONSTRAINT .* PRIMARY KEY/.test(l)).map(key));
  const dropped = new Set(lines.filter((l) => / DROP CONSTRAINT /.test(l)).map(key));
  return lines.filter((l) => {
    const k = key(l);
    return !(k && added.has(k) && dropped.has(k) && (/ PRIMARY KEY/.test(l) || / DROP CONSTRAINT /.test(l)));
  });
}
