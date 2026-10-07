CREATE TABLE "dispensings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"entry_id" uuid,
	"batch_no" text,
	"assay_pct" numeric(6, 2),
	"target_qty" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"within_tolerance" boolean NOT NULL,
	"override_reason" text,
	"dispensed_by" uuid,
	"checked_by" text,
	"dispensed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formula_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"formula_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text DEFAULT 'ingredient' NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"basis" text DEFAULT 'fixed' NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"std_potency" numeric(6, 2),
	"tolerance_pct" numeric(5, 2),
	"cost_share_pct" numeric(5, 2),
	"recovery_rate" numeric(18, 4),
	"stage_seq" smallint,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "formula_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"formula_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL,
	"minutes" numeric(10, 2) DEFAULT '0' NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "formulas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'bulk' NOT NULL,
	"batch_size" numeric(18, 4) NOT NULL,
	"batch_multiple" numeric(18, 4),
	"yield_pct" numeric(6, 2) DEFAULT '100' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"previous_version_id" uuid,
	"material_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"conversion_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"declaration" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "job_cards" ADD COLUMN "readings" jsonb;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD COLUMN "basis" text;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD COLUMN "std_potency" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD COLUMN "tolerance_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "parameters" jsonb;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "formula_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_material_id_work_order_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."work_order_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_entry_id_documents_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_dispensed_by_users_id_fk" FOREIGN KEY ("dispensed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_lines" ADD CONSTRAINT "formula_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_stages" ADD CONSTRAINT "formula_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_stages" ADD CONSTRAINT "formula_stages_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_stages" ADD CONSTRAINT "formula_stages_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_previous_version_id_formulas_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."formulas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispensings_wo_idx" ON "dispensings" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "formula_lines_f_idx" ON "formula_lines" USING btree ("formula_id");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_lines_no_uq" ON "formula_lines" USING btree ("formula_id","line_no");--> statement-breakpoint
CREATE INDEX "formula_stages_f_idx" ON "formula_stages" USING btree ("formula_id");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_stages_seq_uq" ON "formula_stages" USING btree ("formula_id","seq");--> statement-breakpoint
CREATE INDEX "formulas_item_idx" ON "formulas" USING btree ("tenant_id","item_id");