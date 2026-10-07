CREATE TABLE "am_checklists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "am_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"done_on" date NOT NULL,
	"done_by" text NOT NULL,
	"results" jsonb NOT NULL,
	"abnormalities" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amc_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"visits_per_year" smallint,
	"response_hours" smallint,
	"coverage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amc_visits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"called_at" timestamp with time zone,
	"attended_at" timestamp with time zone NOT NULL,
	"engineer" text,
	"notes" text,
	"within_sla" boolean
);
--> statement-breakpoint
CREATE TABLE "asset_spares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"min_qty" numeric(18, 4),
	"alternate_item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "five_s_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"area" text NOT NULL,
	"audit_date" date NOT NULL,
	"auditor" text NOT NULL,
	"sort" smallint NOT NULL,
	"set_in_order" smallint NOT NULL,
	"shine" smallint NOT NULL,
	"standardise" smallint NOT NULL,
	"sustain" smallint NOT NULL,
	"total" smallint NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "kaizens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"area" text NOT NULL,
	"category" text DEFAULT 'cost' NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"benefit" text,
	"annual_savings" numeric(18, 2) DEFAULT '0' NOT NULL,
	"submitted_by" text NOT NULL,
	"implemented_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maint_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"level" text DEFAULT 'machine' NOT NULL,
	"parent_id" uuid,
	"machine_id" uuid,
	"location" text,
	"make" text,
	"model" text,
	"serial_no" text,
	"specs" text,
	"installed_on" date,
	"warranty_until" date,
	"criticality" text DEFAULT 'B' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"meter_unit" text,
	"meter_reading" numeric(18, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"tool_id" uuid,
	"schedule_id" uuid,
	"problem" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"requested_by" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planned_date" date,
	"machine_down" boolean DEFAULT false NOT NULL,
	"stage" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"downtime_minutes" integer,
	"failure_code" text,
	"action_taken" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labour" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meter_reading" numeric(18, 4),
	"labour_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"spares_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amc_contract_id" uuid
);
--> statement-breakpoint
CREATE TABLE "maintenance_spares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"batch_no" text,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reading" numeric(18, 4) NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pm_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid,
	"tool_id" uuid,
	"title" text NOT NULL,
	"trigger" text DEFAULT 'time' NOT NULL,
	"interval_days" integer,
	"interval_meter" numeric(18, 4),
	"last_done_on" date,
	"last_meter" numeric(18, 4),
	"next_due" date,
	"next_meter" numeric(18, 4),
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "am_checklists" ADD CONSTRAINT "am_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "am_checklists" ADD CONSTRAINT "am_checklists_asset_id_maint_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maint_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "am_checks" ADD CONSTRAINT "am_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "am_checks" ADD CONSTRAINT "am_checks_checklist_id_am_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."am_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_contracts" ADD CONSTRAINT "amc_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_contracts" ADD CONSTRAINT "amc_contracts_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_visits" ADD CONSTRAINT "amc_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_visits" ADD CONSTRAINT "amc_visits_contract_id_amc_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."amc_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_visits" ADD CONSTRAINT "amc_visits_order_id_maintenance_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_spares" ADD CONSTRAINT "asset_spares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_spares" ADD CONSTRAINT "asset_spares_asset_id_maint_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maint_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_spares" ADD CONSTRAINT "asset_spares_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_spares" ADD CONSTRAINT "asset_spares_alternate_item_id_items_id_fk" FOREIGN KEY ("alternate_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "five_s_audits" ADD CONSTRAINT "five_s_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaizens" ADD CONSTRAINT "kaizens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_assets" ADD CONSTRAINT "maint_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_assets" ADD CONSTRAINT "maint_assets_parent_id_maint_assets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."maint_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maint_assets" ADD CONSTRAINT "maint_assets_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_asset_id_maint_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maint_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_schedule_id_pm_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."pm_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spares" ADD CONSTRAINT "maintenance_spares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spares" ADD CONSTRAINT "maintenance_spares_order_id_maintenance_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spares" ADD CONSTRAINT "maintenance_spares_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spares" ADD CONSTRAINT "maintenance_spares_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_asset_id_maint_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maint_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_read_by_users_id_fk" FOREIGN KEY ("read_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_asset_id_maint_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maint_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "am_checklists_asset_idx" ON "am_checklists" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "am_checks_uq" ON "am_checks" USING btree ("checklist_id","done_on");--> statement-breakpoint
CREATE INDEX "amc_vendor_idx" ON "amc_contracts" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "amc_visits_contract_idx" ON "amc_visits" USING btree ("contract_id","attended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_spares_uq" ON "asset_spares" USING btree ("asset_id","item_id");--> statement-breakpoint
CREATE INDEX "five_s_area_idx" ON "five_s_audits" USING btree ("tenant_id","area","audit_date");--> statement-breakpoint
CREATE INDEX "kaizens_date_idx" ON "kaizens" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maint_assets_code_uq" ON "maint_assets" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "maint_assets_parent_idx" ON "maint_assets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "maint_assets_machine_idx" ON "maint_assets" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "mwo_asset_idx" ON "maintenance_orders" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "mwo_schedule_idx" ON "maintenance_orders" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "mwo_stage_idx" ON "maintenance_orders" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "maintenance_spares_order_idx" ON "maintenance_spares" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "meter_readings_asset_idx" ON "meter_readings" USING btree ("asset_id","read_at");--> statement-breakpoint
CREATE INDEX "pm_schedules_asset_idx" ON "pm_schedules" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "pm_schedules_due_idx" ON "pm_schedules" USING btree ("tenant_id","next_due");