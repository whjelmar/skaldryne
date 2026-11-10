// Schema as of M2 (expand): entity.name and entity.display_name both exist, kept in sync by a trigger.
// `name` stays NOT NULL in the database. Code written against M2 writes only display_name, so the TypeScript
// side gives `name` a client-side default of SQL NULL ($defaultFn is not part of the DDL); the BEFORE trigger
// fills it from display_name before the NOT NULL check runs.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { defineSchema } from './define.ts';

export const {
  tenant,
  campaign,
  fieldDefinition,
  entity,
  claimVersion,
  claimCurrent,
  claimEmbedding,
  transcriptSegment,
  importRecord,
} = defineSchema({
  name: text('name')
    .notNull()
    .$defaultFn(() => sql`NULL`),
  displayName: text('display_name'),
});
