CREATE TABLE "e_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"meaning" text NOT NULL,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncrs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"severity" text DEFAULT 'major' NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text,
	"qty_affected" numeric(18, 4) NOT NULL,
	"defect_category" text NOT NULL,
	"description" text NOT NULL,
	"party_id" uuid,
	"inspection_id" uuid,
	"work_order_id" uuid,
	"containment" text,
	"use_as_is_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rework_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"return_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sort_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"disposition_notes" text,
	"scrap_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"rework_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sorting_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"recovered" numeric(18, 2) DEFAULT '0' NOT NULL,
	"copq" numeric(18, 2) DEFAULT '0' NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retain_samples" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"location" text NOT NULL,
	"drawn_on" date NOT NULL,
	"retain_until" date NOT NULL,
	"inspection_id" uuid,
	"disposed_on" date,
	"disposed_by" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skip_lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"party_id" uuid,
	"item_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"batch_no" text,
	"lot_qty" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "qc_status" text DEFAULT 'released' NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "qc_note" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "qc_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD COLUMN "skip_lot_after" smallint;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD COLUMN "skip_every" smallint;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "vendor_coa_ref" text;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "coa_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "e_signatures" ADD CONSTRAINT "e_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_signatures" ADD CONSTRAINT "e_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retain_samples" ADD CONSTRAINT "retain_samples_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retain_samples" ADD CONSTRAINT "retain_samples_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retain_samples" ADD CONSTRAINT "retain_samples_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retain_samples" ADD CONSTRAINT "retain_samples_disposed_by_users_id_fk" FOREIGN KEY ("disposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retain_samples" ADD CONSTRAINT "retain_samples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_lots" ADD CONSTRAINT "skip_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_lots" ADD CONSTRAINT "skip_lots_plan_id_inspection_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_lots" ADD CONSTRAINT "skip_lots_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_lots" ADD CONSTRAINT "skip_lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_lots" ADD CONSTRAINT "skip_lots_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "e_signatures_entity_idx" ON "e_signatures" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ncrs_item_idx" ON "ncrs" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "ncrs_party_idx" ON "ncrs" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "retain_samples_item_idx" ON "retain_samples" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "retain_samples_due_idx" ON "retain_samples" USING btree ("tenant_id","retain_until");--> statement-breakpoint
CREATE INDEX "skip_lots_plan_idx" ON "skip_lots" USING btree ("plan_id","created_at");--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;