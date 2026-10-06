CREATE TABLE "job_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operator_id" uuid,
	"operator_name" text,
	"machine_id" uuid,
	"tool_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" numeric(10, 2) DEFAULT '0' NOT NULL,
	"good_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reject_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"labour_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"machine_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"overhead_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subcontract_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"absorbed_in" uuid,
	"job_work_challan_id" uuid,
	"reject_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"good_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reject_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"material_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"conversion_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subcontract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"output_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"variance_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "production_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text NOT NULL,
	"material_id" uuid,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"batch_no" text,
	"serial_nos" jsonb,
	"backflushed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text DEFAULT 'component' NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"required_qty" numeric(18, 4) NOT NULL,
	"issued_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"operation_seq" smallint,
	"recovery_rate" numeric(18, 4),
	"std_rate" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL,
	"tool_id" uuid,
	"setup_minutes" numeric(10, 2) DEFAULT '0' NOT NULL,
	"run_minutes" numeric(10, 4) DEFAULT '0' NOT NULL,
	"planned_minutes" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_subcontract" boolean DEFAULT false NOT NULL,
	"vendor_id" uuid,
	"subcontract_rate" numeric(18, 4),
	"inspection" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"good_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reject_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"actual_minutes" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'mts' NOT NULL,
	"item_id" uuid NOT NULL,
	"bom_id" uuid,
	"sales_order_id" uuid,
	"sales_order_line_id" uuid,
	"parent_work_order_id" uuid,
	"qty" numeric(18, 4) NOT NULL,
	"produced_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"source_warehouse_id" uuid NOT NULL,
	"target_warehouse_id" uuid NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"priority" smallint DEFAULT 3 NOT NULL,
	"backflush" boolean DEFAULT false NOT NULL,
	"stage" text DEFAULT 'planned' NOT NULL,
	"std_material" numeric(18, 4) DEFAULT '0' NOT NULL,
	"std_operation" numeric(18, 4) DEFAULT '0' NOT NULL,
	"std_subcontract" numeric(18, 4) DEFAULT '0' NOT NULL,
	"std_byproduct" numeric(18, 4) DEFAULT '0' NOT NULL,
	"std_unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"material_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"conversion_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subcontract_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"byproduct_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"output_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"variance_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"release_check" jsonb,
	"closed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_operation_id_work_order_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_absorbed_in_documents_id_fk" FOREIGN KEY ("absorbed_in") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_job_work_challan_id_job_work_challans_id_fk" FOREIGN KEY ("job_work_challan_id") REFERENCES "public"."job_work_challans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entry_lines" ADD CONSTRAINT "production_entry_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entry_lines" ADD CONSTRAINT "production_entry_lines_entry_id_production_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."production_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entry_lines" ADD CONSTRAINT "production_entry_lines_material_id_work_order_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."work_order_materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entry_lines" ADD CONSTRAINT "production_entry_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_entry_lines" ADD CONSTRAINT "production_entry_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_parent_work_order_id_work_orders_id_fk" FOREIGN KEY ("parent_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_target_warehouse_id_warehouses_id_fk" FOREIGN KEY ("target_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_cards_wo_idx" ON "job_cards" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "job_cards_status_idx" ON "job_cards" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "prod_entries_wo_idx" ON "production_entries" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "prod_lines_entry_idx" ON "production_entry_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prod_lines_no_uq" ON "production_entry_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "wo_mat_wo_idx" ON "work_order_materials" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "wo_mat_item_idx" ON "work_order_materials" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wo_mat_no_uq" ON "work_order_materials" USING btree ("work_order_id","line_no");--> statement-breakpoint
CREATE INDEX "wo_ops_wo_idx" ON "work_order_operations" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wo_ops_seq_uq" ON "work_order_operations" USING btree ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "wo_item_idx" ON "work_orders" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "wo_so_idx" ON "work_orders" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "wo_stage_idx" ON "work_orders" USING btree ("tenant_id","stage");