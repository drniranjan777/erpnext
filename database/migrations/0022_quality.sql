CREATE TABLE "inspection_parameters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'numeric' NOT NULL,
	"unit" text,
	"nominal" numeric(18, 6),
	"lower_limit" numeric(18, 6),
	"upper_limit" numeric(18, 6),
	"is_critical" boolean DEFAULT false NOT NULL,
	"method" text
);
--> statement-breakpoint
CREATE TABLE "inspection_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"item_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"operation_seq" smallint,
	"sampling" text DEFAULT 'aql' NOT NULL,
	"inspection_level" text DEFAULT 'II' NOT NULL,
	"aql" text DEFAULT '2.5' NOT NULL,
	"fixed_sample_size" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"sample_no" smallint NOT NULL,
	"value" numeric(18, 6),
	"passed" boolean,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "quality_inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"plan_id" uuid,
	"item_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"work_order_id" uuid,
	"operation_id" uuid,
	"job_card_id" uuid,
	"warehouse_id" uuid,
	"batch_no" text,
	"lot_qty" numeric(18, 4) NOT NULL,
	"sample_size" integer NOT NULL,
	"accept_no" integer DEFAULT 0 NOT NULL,
	"reject_no" integer DEFAULT 1 NOT NULL,
	"code_letter" text,
	"defectives" integer DEFAULT 0 NOT NULL,
	"suggestion" text,
	"result" text DEFAULT 'pending' NOT NULL,
	"accepted_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rework_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"release_warehouse_id" uuid,
	"reject_warehouse_id" uuid,
	"rework_order_id" uuid,
	"inspected_by" uuid,
	"remarks" text
);
--> statement-breakpoint
ALTER TABLE "inspection_parameters" ADD CONSTRAINT "inspection_parameters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_parameters" ADD CONSTRAINT "inspection_parameters_plan_id_inspection_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_readings" ADD CONSTRAINT "inspection_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_readings" ADD CONSTRAINT "inspection_readings_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_readings" ADD CONSTRAINT "inspection_readings_parameter_id_inspection_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."inspection_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_plan_id_inspection_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_operation_id_work_order_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_release_warehouse_id_warehouses_id_fk" FOREIGN KEY ("release_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_reject_warehouse_id_warehouses_id_fk" FOREIGN KEY ("reject_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_rework_order_id_work_orders_id_fk" FOREIGN KEY ("rework_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_params_plan_idx" ON "inspection_parameters" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_params_seq_uq" ON "inspection_parameters" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plans_code_uq" ON "inspection_plans" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "inspection_plans_item_idx" ON "inspection_plans" USING btree ("tenant_id","item_id","stage");--> statement-breakpoint
CREATE INDEX "readings_insp_idx" ON "inspection_readings" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "readings_uq" ON "inspection_readings" USING btree ("inspection_id","parameter_id","sample_no");--> statement-breakpoint
CREATE INDEX "qi_item_idx" ON "quality_inspections" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "qi_source_idx" ON "quality_inspections" USING btree ("source_doc_id");--> statement-breakpoint
CREATE INDEX "qi_wo_idx" ON "quality_inspections" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "qi_result_idx" ON "quality_inspections" USING btree ("tenant_id","result");