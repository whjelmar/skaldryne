// Schema as of M1: entity.name only.
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
} = defineSchema({ name: text('name').notNull() });
