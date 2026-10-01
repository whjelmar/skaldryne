// Schema as of M3 (contract): entity.name is gone, display_name is NOT NULL. This is the current schema.
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
} = defineSchema({ displayName: text('display_name').notNull() });
