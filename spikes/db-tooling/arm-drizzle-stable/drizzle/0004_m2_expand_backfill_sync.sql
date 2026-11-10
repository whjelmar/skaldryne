-- Custom migration (drizzle-kit generate --custom): M2 expand, part 2.
-- Backfill display_name from name, then keep the two columns in sync while both exist.
UPDATE entity SET display_name = name WHERE display_name IS NULL;
--> statement-breakpoint
CREATE FUNCTION entity_name_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_name := coalesce(NEW.display_name, NEW.name);
    NEW.name := coalesce(NEW.name, NEW.display_name);
  ELSIF NEW.name IS DISTINCT FROM OLD.name AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN
    NEW.display_name := NEW.name;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    NEW.name := NEW.display_name;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entity_name_sync
  BEFORE INSERT OR UPDATE ON entity
  FOR EACH ROW EXECUTE FUNCTION entity_name_sync();
