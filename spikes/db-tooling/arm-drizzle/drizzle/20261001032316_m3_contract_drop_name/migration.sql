ALTER TABLE "entity" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "entity" ALTER COLUMN "display_name" SET NOT NULL;