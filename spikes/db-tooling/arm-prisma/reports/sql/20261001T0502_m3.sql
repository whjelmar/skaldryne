-- Extracted from migrations/app/20261001T0502_m3/ops.json by scripts/extract-sql.ts

-- raw.entity.display_name_sync.drop: Drop the trigger keeping "entity".name and display_name in sync (1/2)
DROP TRIGGER entity_name_sync ON public.entity;

-- raw.entity.display_name_sync.drop: Drop the trigger keeping "entity".name and display_name in sync (2/2)
DROP FUNCTION public.entity_name_sync();

-- data_migration.handle-nulls-entity-display_name: Run handle-nulls-entity-display_name
UPDATE "public"."entity" SET "display_name" = "name" WHERE "display_name" IS NULL;

-- dropColumn.entity.name: drop column "name"
ALTER TABLE "public"."entity" DROP COLUMN "name";

-- alterNullability.setNotNull.entity.display_name: set NOT NULL on "display_name"
ALTER TABLE "public"."entity" ALTER COLUMN "display_name" SET NOT NULL;
