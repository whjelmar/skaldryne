// T8: CI fit. (a) squawk over the executed migration SQL, (b) pgTAP RLS checks in the container,
// (c) is `pnpm test` itself: bootstrap from scratch, typecheck, then this suite.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_DIR } from '../src/migrations.ts';
import { ARM_DIR, saveOutput } from './helpers.ts';

describe('T8 CI fit', () => {
  test('T8a squawk runs over the migration.sql files the migrator executes', () => {
    const files = readdirSync(MIGRATIONS_DIR).map((d) => join('drizzle', d, 'migration.sql'));
    // pnpm.cmd needs a shell on Windows; the command is built from fixed strings and our own folder names.
    // --assume-in-transaction: the migrator wraps every pending migration in one transaction.
    const command = `pnpm dlx squawk-cli@2.66.0 --assume-in-transaction --reporter gcc ${files.join(' ')}`;
    const r = spawnSync(command, {
      cwd: ARM_DIR,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const output = `${r.stdout}${r.stderr}`;
    saveOutput('t8-squawk.txt', output);
    // gcc reporter: "file:line:col: warning: rule-name message"
    const byRule = new Map<string, number>();
    for (const m of output.matchAll(/:\d+:\d+: (?:warning|error):? ([a-z-]+)/g)) byRule.set(m[1]!, (byRule.get(m[1]!) ?? 0) + 1);
    saveOutput('t8-squawk-summary.json', JSON.stringify(Object.fromEntries(byRule), null, 2));
    expect(r.error).toBeUndefined();
    expect(byRule.size).toBeGreaterThan(0); // squawk ran and parsed every file
    expect(output).not.toMatch(/syntax error|failed to parse/i);
  });

  test('T8b pgTAP: RLS and the tenant_isolation policy on every tenant table', () => {
    const r = spawnSync('docker', ['exec', '-i', 'db-tooling-db-1', 'psql', '-X', '-U', 'skal_migrator', '-d', 'drizzle_app'], {
      input: readFileSync(join(ARM_DIR, 'test', 'pgtap', 'rls.sql'), 'utf8'),
      encoding: 'utf8',
    });
    const tap = `${r.stdout}${r.stderr}`;
    saveOutput('t8-pgtap.txt', tap);
    expect(r.status).toBe(0);
    expect(tap).toMatch(/^1\.\.55$/m);
    expect(tap.match(/^ok \d+/gm)).toHaveLength(55);
    expect(tap).not.toMatch(/^not ok/m);
  });
});
