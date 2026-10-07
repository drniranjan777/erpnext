CREATE TABLE "wms_bin_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(18, 4) NOT NULL,
	"kind" text NOT NULL,
	"voucher_type" text,
	"voucher_id" uuid,
	"task_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_bin_stock" (
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_key" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wms_bin_stock_bin_id_item_id_batch_key_pk" PRIMARY KEY("bin_id","item_id","batch_key")
);
--> statement-breakpoint
CREATE TABLE "wms_bins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"aisle" text,
	"rack" text,
	"shelf" text,
	"position" text,
	"bin_type" text DEFAULT 'shelf' NOT NULL,
	"max_weight_kg" numeric(12, 3),
	"max_volume_m3" numeric(12, 4),
	"max_qty" numeric(18, 4),
	"pick_sequence" integer DEFAULT 1000 NOT NULL,
	"fixed_item_id" uuid,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"grid_x" smallint,
	"grid_y" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_item_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"condition" text DEFAULT 'ambient' NOT NULL,
	"hazard_class" text,
	"unit_weight_kg" numeric(12, 4),
	"unit_volume_m3" numeric(12, 6),
	"abc_class" text,
	"min_shelf_life_days" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(18, 4) NOT NULL,
	"from_bin_id" uuid,
	"to_bin_id" uuid,
	"reason" text,
	"source_type" text,
	"source_id" uuid,
	"assignee_id" uuid,
	"done_qty" numeric(18, 4),
	"done_bin_id" uuid,
	"override_reason" text,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"receiving_bin_id" uuid,
	"dispatch_bin_id" uuid,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "wms_zones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'storage' NOT NULL,
	"condition" text DEFAULT 'ambient' NOT NULL,
	"sequence" smallint DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wms_bin_ledger" ADD CONSTRAINT "wms_bin_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_ledger" ADD CONSTRAINT "wms_bin_ledger_bin_id_wms_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_ledger" ADD CONSTRAINT "wms_bin_ledger_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_ledger" ADD CONSTRAINT "wms_bin_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_stock" ADD CONSTRAINT "wms_bin_stock_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_stock" ADD CONSTRAINT "wms_bin_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_stock" ADD CONSTRAINT "wms_bin_stock_bin_id_wms_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bin_stock" ADD CONSTRAINT "wms_bin_stock_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_zone_id_wms_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."wms_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_bins" ADD CONSTRAINT "wms_bins_fixed_item_id_items_id_fk" FOREIGN KEY ("fixed_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD CONSTRAINT "wms_item_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD CONSTRAINT "wms_item_profiles_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_from_bin_id_wms_bins_id_fk" FOREIGN KEY ("from_bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_to_bin_id_wms_bins_id_fk" FOREIGN KEY ("to_bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_done_bin_id_wms_bins_id_fk" FOREIGN KEY ("done_bin_id") REFERENCES "public"."wms_bins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_warehouses" ADD CONSTRAINT "wms_warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_warehouses" ADD CONSTRAINT "wms_warehouses_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_warehouses" ADD CONSTRAINT "wms_warehouses_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_zones" ADD CONSTRAINT "wms_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_zones" ADD CONSTRAINT "wms_zones_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wms_bin_ledger_voucher_idx" ON "wms_bin_ledger" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "wms_bin_ledger_bin_idx" ON "wms_bin_ledger" USING btree ("bin_id","created_at");--> statement-breakpoint
CREATE INDEX "wms_bin_stock_item_idx" ON "wms_bin_stock" USING btree ("tenant_id","item_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_bins_code_uq" ON "wms_bins" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "wms_bins_zone_idx" ON "wms_bins" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "wms_bins_fixed_idx" ON "wms_bins" USING btree ("tenant_id","fixed_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_item_profiles_item_uq" ON "wms_item_profiles" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_tasks_number_uq" ON "wms_tasks" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "wms_tasks_open_idx" ON "wms_tasks" USING btree ("tenant_id","warehouse_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_warehouses_wh_uq" ON "wms_warehouses" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_zones_code_uq" ON "wms_zones" USING btree ("warehouse_id","code");