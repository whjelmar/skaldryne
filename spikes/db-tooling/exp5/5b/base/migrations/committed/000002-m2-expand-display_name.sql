--! Previous: sha1:ae794fcc368e9dcedd0b2c2efc59ce587bc4edb0
--! Hash: sha1:4742f941125e90df08fdb1f8f9c1338f75bc7418
--! Message: M2 expand display_name

-- M2 (expand): add entity.display_name, backfill it from name, keep both in sync while both exist.
ALTER TABLE entity ADD COLUMN display_name text;

UPDATE entity SET display_name = name WHERE display_name IS NULL;

-- BEFORE ROW trigger: runs before NOT NULL is checked, so M2 code may insert display_name only
-- and M1 code may insert name only.
CREATE FUNCTION entity_name_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.display_name IS NULL THEN
      NEW.display_name := NEW.name;
    ELSIF NEW.name IS NULL THEN
      NEW.name := NEW.display_name;
    END IF;
  ELSE
    IF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
      NEW.name := NEW.display_name;
    ELSIF NEW.name IS DISTINCT FROM OLD.name AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN
      NEW.display_name := NEW.name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER entity_name_sync
  BEFORE INSERT OR UPDATE ON entity
  FOR EACH ROW EXECUTE FUNCTION entity_name_sync();
