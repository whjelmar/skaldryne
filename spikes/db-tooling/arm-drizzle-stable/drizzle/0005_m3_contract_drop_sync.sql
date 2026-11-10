-- Custom migration (drizzle-kit generate --custom): M3 contract, part 1.
-- Remove the sync trigger before the generated migration drops entity.name.
DROP TRIGGER entity_name_sync ON entity;
--> statement-breakpoint
DROP FUNCTION entity_name_sync();
