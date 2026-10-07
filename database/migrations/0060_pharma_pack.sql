CREATE TABLE "dpco_ceilings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ceiling_price" double precision NOT NULL,
	"notification" text,
	"effective_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharma_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manufacturing_licence_no" text,
	"import_licence_no" text
);
--> statement-breakpoint
CREATE TABLE "serial_containers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"level" text NOT NULL,
	"parent_id" uuid,
	"item_id" uuid,
	"batch_no" text,
	"status" text DEFAULT 'closed' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gtin" text NOT NULL,
	"serial" text NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date NOT NULL,
	"work_order_id" uuid,
	"status" text DEFAULT 'commissioned' NOT NULL,
	"container_id" uuid,
	"decommission_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stability_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"time_point" double precision NOT NULL,
	"test" text NOT NULL,
	"value" double precision NOT NULL,
	"ok" integer NOT NULL,
	"tested_on" date NOT NULL,
	"tested_by" uuid,
	"notes" text,
	"deviation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "stability_studies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"protocol_no" text,
	"kind" text NOT NULL,
	"temperature_c" double precision NOT NULL,
	"humidity_pct" double precision,
	"packing" text,
	"start_date" date NOT NULL,
	"time_points" jsonb NOT NULL,
	"tests" jsonb NOT NULL,
	"claimed_shelf_life_months" smallint,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dpco_ceilings" ADD CONSTRAINT "dpco_ceilings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpco_ceilings" ADD CONSTRAINT "dpco_ceilings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpco_ceilings" ADD CONSTRAINT "dpco_ceilings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharma_settings" ADD CONSTRAINT "pharma_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_containers" ADD CONSTRAINT "serial_containers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_containers" ADD CONSTRAINT "serial_containers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_containers" ADD CONSTRAINT "serial_containers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_units" ADD CONSTRAINT "serial_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_units" ADD CONSTRAINT "serial_units_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_units" ADD CONSTRAINT "serial_units_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_results" ADD CONSTRAINT "stability_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_results" ADD CONSTRAINT "stability_results_study_id_stability_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."stability_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_results" ADD CONSTRAINT "stability_results_tested_by_users_id_fk" FOREIGN KEY ("tested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_studies" ADD CONSTRAINT "stability_studies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_studies" ADD CONSTRAINT "stability_studies_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stability_studies" ADD CONSTRAINT "stability_studies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dpco_item_idx" ON "dpco_ceilings" USING btree ("tenant_id","item_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pharma_settings_uq" ON "pharma_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_containers_code_uq" ON "serial_containers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "serial_containers_parent_idx" ON "serial_containers" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_units_uq" ON "serial_units" USING btree ("tenant_id","gtin","serial");--> statement-breakpoint
CREATE INDEX "serial_units_batch_idx" ON "serial_units" USING btree ("tenant_id","item_id","batch_no");--> statement-breakpoint
CREATE INDEX "serial_units_container_idx" ON "serial_units" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stability_results_uq" ON "stability_results" USING btree ("tenant_id","study_id","time_point","test");--> statement-breakpoint
CREATE UNIQUE INDEX "stability_studies_code_uq" ON "stability_studies" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "stability_studies_item_idx" ON "stability_studies" USING btree ("tenant_id","item_id");