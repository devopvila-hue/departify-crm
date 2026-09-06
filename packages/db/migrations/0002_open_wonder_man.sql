ALTER TABLE "contacts" ADD COLUMN "public_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_public_slug_uq" ON "contacts" USING btree ("public_slug") WHERE public_slug IS NOT NULL;