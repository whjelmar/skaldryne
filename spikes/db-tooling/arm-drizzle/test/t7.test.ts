// T7: one script brings a fleet (one database at M1, one at M2) to M3 and reports each one's applied state.
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { appliedMigrations, foldersUpTo, migrateTo } from '../src/migrations.ts';
import { formatReport, migrateFleet } from '../scripts/fleet.ts';
import { ARM_DIR, saveOutput } from './helpers.ts';

describe('T7 a fleet of databases', () => {
  test('T7 programmatic: M1 and M2 databases both reach M3 with identical applied state', async () => {
    await migrateTo('drizzle_fleet_a', 'm1');
    await migrateTo('drizzle_fleet_b', 'm2');
    expect((await appliedMigrations('drizzle_fleet_a')).map((m) => m.name)).toEqual(foldersUpTo('m1'));
    expect((await appliedMigrations('drizzle_fleet_b')).map((m) => m.name)).toEqual(foldersUpTo('m2'));

    const reports = await migrateFleet(['drizzle_fleet_a', 'drizzle_fleet_b']);
    saveOutput('t7-fleet.txt', formatReport(reports));
    const [a, b] = reports;
    expect(a).toMatchObject({ before: 3, after: 7, head: foldersUpTo('m3').at(-1) });
    expect(b).toMatchObject({ before: 5, after: 7, head: foldersUpTo('m3').at(-1) });
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect(a!.applied.map((m) => [m.name, m.hash])).toEqual(b!.applied.map((m) => [m.name, m.hash]));
  });

  test('T7 the same script from the command line is a no-op once the fleet is current', () => {
    const r = spawnSync(process.execPath, ['scripts/fleet.ts', 'drizzle_fleet_a', 'drizzle_fleet_b', 'drizzle_app'], {
      cwd: ARM_DIR,
      encoding: 'utf8',
    });
    saveOutput('t7-fleet-cli.txt', r.stdout + r.stderr);
    expect(r.status).toBe(0);
    expect(r.stdout.match(/7 -> 7 applied/g)).toHaveLength(3);
    expect(new Set(r.stdout.match(/fingerprint=\w+/g)).size).toBe(1);
  });
});
