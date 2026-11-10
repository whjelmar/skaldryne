--! Previous: sha1:4742f941125e90df08fdb1f8f9c1338f75bc7418
--! Hash: sha1:baa1a407dd27a14e796ad1fd491bd0bf6b23254c
--! Message: M3 contract drop name

-- M3 (contract): drop entity.name; display_name becomes NOT NULL.
DROP TRIGGER entity_name_sync ON entity;
DROP FUNCTION entity_name_sync();

-- Belt and braces: rows written by anything that bypassed the trigger.
UPDATE entity SET display_name = name WHERE display_name IS NULL;

ALTER TABLE entity ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE entity DROP COLUMN name;
