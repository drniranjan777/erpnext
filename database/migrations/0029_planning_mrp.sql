CREATE TABLE "demand_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"stat_qty" numeric(18, 4),
	"method" text,
	"mae" numeric(18, 4),
	"mape_pct" numeric(8, 1),
	"is_override" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_planning" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"lot_sizing" text DEFAULT 'l4l' NOT NULL,
	"lot_qty" numeric(18, 4),
	"period_days" integer,
	"order_cost" numeric(18, 4),
	"holding_pct" numeric(6, 2),
	"excluded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrp_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date,
	"to_date" date,
	"qty" numeric(18, 4),
	"ref_kind" text,
	"ref_id" uuid,
	"ref_number" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrp_item_plans" (
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"on_hand" numeric(18, 4) NOT NULL,
	"safety_stock" numeric(18, 4) NOT NULL,
	"demand" numeric(18, 4) NOT NULL,
	"receipts" numeric(18, 4) NOT NULL,
	"planned" numeric(18, 4) NOT NULL,
	"end_balance" numeric(18, 4) NOT NULL,
	"first_shortage" date,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrp_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"horizon_days" smallint NOT NULL,
	"use_forecast" boolean DEFAULT true NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "planned_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid,
	"item_id" uuid NOT NULL,
	"source" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"due_date" date NOT NULL,
	"release_date" date NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"pegs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ref_key" integer,
	"converted_doc_id" uuid,
	"converted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_forecasts" ADD CONSTRAINT "demand_forecasts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_planning" ADD CONSTRAINT "item_planning_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_planning" ADD CONSTRAINT "item_planning_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_exceptions" ADD CONSTRAINT "mrp_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_exceptions" ADD CONSTRAINT "mrp_exceptions_run_id_mrp_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mrp_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_exceptions" ADD CONSTRAINT "mrp_exceptions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_item_plans" ADD CONSTRAINT "mrp_item_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_item_plans" ADD CONSTRAINT "mrp_item_plans_run_id_mrp_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mrp_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_item_plans" ADD CONSTRAINT "mrp_item_plans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_runs" ADD CONSTRAINT "mrp_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrp_runs" ADD CONSTRAINT "mrp_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_run_id_mrp_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mrp_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_converted_doc_id_documents_id_fk" FOREIGN KEY ("converted_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demand_forecasts_uq" ON "demand_forecasts" USING btree ("tenant_id","item_id","period");--> statement-breakpoint
CREATE INDEX "demand_forecasts_period_idx" ON "demand_forecasts" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "item_planning_tenant_idx" ON "item_planning" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mrp_exceptions_run_idx" ON "mrp_exceptions" USING btree ("run_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "mrp_item_plans_uq" ON "mrp_item_plans" USING btree ("run_id","item_id");--> statement-breakpoint
CREATE INDEX "mrp_runs_tenant_idx" ON "mrp_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "planned_orders_tenant_idx" ON "planned_orders" USING btree ("tenant_id","status","release_date");--> statement-breakpoint
CREATE INDEX "planned_orders_item_idx" ON "planned_orders" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "planned_orders_run_idx" ON "planned_orders" USING btree ("run_id");