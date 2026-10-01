import { defineConfig } from 'drizzle-kit';

// SCHEMA_VERSION picks which historical schema drizzle-kit diffs against the last snapshot. Migrations were
// generated in order with m1, m2, m3; the default (m3) is the current schema.
const version = process.env.SCHEMA_VERSION ?? 'm3';

export default defineConfig({
  dialect: 'postgresql',
  schema: `./src/schema/${version}.ts`,
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://skal_migrator:migrator@localhost:55432/drizzle_app',
  },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  // Only public is ours. Bootstrap installs pgTAP in schema tap, which push would otherwise offer to drop.
  schemaFilter: ['public'],
  // The schema cannot declare claim_version's hash partitions, so push/pull would otherwise propose dropping them.
  // T4 runs push once with RAW_INTROSPECTION=1 to show that.
  ...(process.env.RAW_INTROSPECTION ? {} : { tablesFilter: ['!claim_version_p*'] }),
});
