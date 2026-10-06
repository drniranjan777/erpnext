CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text DEFAULT 'component' NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"uom_id" uuid NOT NULL,
	"scrap_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_phantom" boolean DEFAULT false NOT NULL,
	"alternate_group" text,
	"priority" smallint DEFAULT 1 NOT NULL,
	"operation_seq" smallint,
	"recovery_rate" numeric(18, 4),
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "bom_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL,
	"tool_id" uuid,
	"setup_minutes" numeric(10, 2) DEFAULT '0' NOT NULL,
	"run_minutes" numeric(10, 4) DEFAULT '0' NOT NULL,
	"is_subcontract" boolean DEFAULT false NOT NULL,
	"vendor_id" uuid,
	"subcontract_rate" numeric(18, 4),
	"inspection" boolean DEFAULT false NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"previous_version_id" uuid,
	"material_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"operation_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"subcontract_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"byproduct_credit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"drawing_no" text,
	"drawing_revision" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL,
	"make" text,
	"model" text,
	"serial_no" text,
	"capacity" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'mould' NOT NULL,
	"cavities" smallint DEFAULT 1 NOT NULL,
	"life_shots" integer,
	"shots_used" integer DEFAULT 0 NOT NULL,
	"maintenance_every" integer,
	"last_maintenance_at" integer DEFAULT 0 NOT NULL,
	"machine_id" uuid,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'machine' NOT NULL,
	"warehouse_id" uuid,
	"hours_per_day" numeric(5, 2) DEFAULT '8' NOT NULL,
	"units" smallint DEFAULT 1 NOT NULL,
	"efficiency_pct" numeric(5, 2) DEFAULT '100' NOT NULL,
	"labour_rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"machine_rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"overhead_rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operations" ADD CONSTRAINT "bom_operations_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_previous_version_id_boms_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."boms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_lines_bom_idx" ON "bom_lines" USING btree ("bom_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_no_uq" ON "bom_lines" USING btree ("bom_id","line_no");--> statement-breakpoint
CREATE INDEX "bom_ops_bom_idx" ON "bom_operations" USING btree ("bom_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_ops_seq_uq" ON "bom_operations" USING btree ("bom_id","seq");--> statement-breakpoint
CREATE INDEX "boms_item_idx" ON "boms" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_code_uq" ON "machines" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_code_uq" ON "tools" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "work_centers_code_uq" ON "work_centers" USING btree ("tenant_id","code");