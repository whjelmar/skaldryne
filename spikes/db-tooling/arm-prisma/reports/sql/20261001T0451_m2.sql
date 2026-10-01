-- Extracted from migrations/app/20261001T0451_m2/ops.json by scripts/extract-sql.ts

-- column.public.entity.display_name: add column "display_name"
ALTER TABLE "public"."entity" ADD COLUMN "display_name" text;

-- alterNullability.dropNotNull.entity.name: drop NOT NULL on "name"
ALTER TABLE "public"."entity" ALTER COLUMN "name" DROP NOT NULL;

-- raw.entity.display_name_sync: Create trigger keeping "entity".name and display_name in sync (1/2)
CREATE FUNCTION public.entity_name_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_name := COALESCE(NEW.display_name, NEW.name);
    NEW.name := COALESCE(NEW.name, NEW.display_name);
  ELSIF NEW.name IS DISTINCT FROM OLD.name AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN
    NEW.display_name := NEW.name;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    NEW.name := NEW.display_name;
  END IF;
  RETURN NEW;
END $fn$;

-- raw.entity.display_name_sync: Create trigger keeping "entity".name and display_name in sync (2/2)
CREATE TRIGGER entity_name_sync BEFORE INSERT OR UPDATE ON public.entity
  FOR EACH ROW EXECUTE FUNCTION public.entity_name_sync();

-- data_migration.backfill-entity-display_name: Run backfill-entity-display_name
UPDATE "public"."entity" SET "display_name" = "name" WHERE "display_name" IS NULL;
