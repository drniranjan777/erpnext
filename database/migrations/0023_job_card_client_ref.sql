ALTER TABLE "job_cards" ADD COLUMN "client_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "job_cards_client_ref_uq" ON "job_cards" USING btree ("tenant_id","client_ref");