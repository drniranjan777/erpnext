CREATE TABLE "wms_bin_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_key" uuid NOT NULL,
	"new_batch_no" text,
	"system_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(18, 4),
	"counted_by" uuid,
	"counted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wms_bin_counts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"kind" text DEFAULT 'cycle' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"blind" boolean DEFAULT true NOT NULL,
	"entry_id" uuid,
	"accuracy_pct" numeric(5, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wms_consignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_dips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"dip_mm" numeric(10, 1) NOT NULL,
	"temperature_c" numeric(5, 1),
	"litres" numeric(14, 2) NOT NULL,
	"measured_qty" numeric(18, 4) NOT NULL,
	"book_qty" numeric(18, 4) NOT NULL,
	"variance" numeric(18, 4) NOT NULL,
	"within_tolerance" boolean NOT NULL,
	"entry_id" uuid,
	"read_by" uuid,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_reel_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty" numeric(18, 4),
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid
);
--> statement-breakpoint
CREATE TABLE "wms_reels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"warehouse_id" uuid,
	"bin_id" uuid,
	"qty" numeric(18, 4) NOT NULL,
	"msl_level" text,
	"exposed_minutes" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"status" text DEFAULT 'sealed' NOT NULL,
	"bake_count" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_returnable_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"date" text NOT NULL,
	"reference" text,
	"document_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_returnable_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"deposit_amount" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_tanks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"capacity_litres" numeric(14, 2) NOT NULL,
	"stock_unit" text DEFAULT 'litre' NOT NULL,
	"density_kg_per_l" numeric(8, 4),
	"calibration" jsonb NOT NULL,
	"tolerance_pct" numeric(5, 2) DEFAULT '0.5' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_entry_lines" ADD COLUMN "bin_id" uuid;--> statement-breakpoint
ALTER TABLE "wms_bins" ADD COLUMN "replen_min" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "wms_bins" ADD COLUMN "replen_max" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "wms_bins" ADD COLUMN "last_counted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD COLUMN "msl_level" text;--> statement-breakpoint
ALTER TABLE "wms_settings" ADD COLUMN "count_days_a" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "wms_settings" ADD COLUMN "count_days_b" smallint DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "wms_settings" ADD COLUMN "count_days_c" smallint DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "wms_bin_count_lines" ADD CONSTRAINT "wms_bin_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_count_lines" ADD CONSTRAINT "wms_bin_count_lines_count_id_wms_bin_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."wms_bin_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_count_lines" ADD CONSTRAINT "wms_bin_count_lines_bin_id_wms_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_count_lines" ADD CONSTRAINT "wms_bin_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_count_lines" ADD CONSTRAINT "wms_bin_count_lines_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_counts" ADD CONSTRAINT "wms_bin_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_counts" ADD CONSTRAINT "wms_bin_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_counts" ADD CONSTRAINT "wms_bin_counts_entry_id_documents_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_counts" ADD CONSTRAINT "wms_bin_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_consignments" ADD CONSTRAINT "wms_consignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_consignments" ADD CONSTRAINT "wms_consignments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_consignments" ADD CONSTRAINT "wms_consignments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dips" ADD CONSTRAINT "wms_dips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dips" ADD CONSTRAINT "wms_dips_tank_id_wms_tanks_id_fk" FOREIGN KEY ("tank_id") REFERENCES "public"."wms_tanks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dips" ADD CONSTRAINT "wms_dips_entry_id_documents_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dips" ADD CONSTRAINT "wms_dips_read_by_users_id_fk" FOREIGN KEY ("read_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reel_events" ADD CONSTRAINT "wms_reel_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reel_events" ADD CONSTRAINT "wms_reel_events_reel_id_wms_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."wms_reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reel_events" ADD CONSTRAINT "wms_reel_events_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_bin_id_wms_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_reels" ADD CONSTRAINT "wms_reels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_moves" ADD CONSTRAINT "wms_returnable_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_moves" ADD CONSTRAINT "wms_returnable_moves_type_id_wms_returnable_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."wms_returnable_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_moves" ADD CONSTRAINT "wms_returnable_moves_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_moves" ADD CONSTRAINT "wms_returnable_moves_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_moves" ADD CONSTRAINT "wms_returnable_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_returnable_types" ADD CONSTRAINT "wms_returnable_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tanks" ADD CONSTRAINT "wms_tanks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tanks" ADD CONSTRAINT "wms_tanks_bin_id_wms_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tanks" ADD CONSTRAINT "wms_tanks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wms_bin_count_lines_count_idx" ON "wms_bin_count_lines" USING btree ("count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_bin_counts_number_uq" ON "wms_bin_counts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_consignments_wh_uq" ON "wms_consignments" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "wms_dips_tank_idx" ON "wms_dips" USING btree ("tank_id","read_at");--> statement-breakpoint
CREATE INDEX "wms_reel_events_reel_idx" ON "wms_reel_events" USING btree ("reel_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_reels_code_uq" ON "wms_reels" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "wms_reels_item_idx" ON "wms_reels" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "wms_returnable_moves_party_idx" ON "wms_returnable_moves" USING btree ("tenant_id","party_id","type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_returnable_types_code_uq" ON "wms_returnable_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_tanks_bin_uq" ON "wms_tanks" USING btree ("bin_id");