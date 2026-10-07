CREATE TABLE "asns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"delivery_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"shipped_at" timestamp with time zone NOT NULL,
	"expected_at" timestamp with time zone,
	"transporter" text,
	"vehicle_no" text,
	"lr_no" text,
	"packages" integer,
	"lines" jsonb NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpq_estimates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"party_id" uuid,
	"opportunity_id" uuid,
	"item_id" uuid,
	"qty" numeric(18, 4) NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"unit_cost" numeric(16, 2) NOT NULL,
	"unit_price" numeric(16, 2) NOT NULL,
	"margin_pct" numeric(5, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"quotation_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpq_option_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"multi" boolean DEFAULT false NOT NULL,
	"sequence" smallint DEFAULT 1 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpq_quote_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"terms" text NOT NULL,
	"validity_days" smallint DEFAULT 30 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_schedule_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"date" date NOT NULL,
	"qty" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"customer_part_no" text,
	"month" text NOT NULL,
	"revision" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asns" ADD CONSTRAINT "asns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asns" ADD CONSTRAINT "asns_delivery_id_documents_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asns" ADD CONSTRAINT "asns_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asns" ADD CONSTRAINT "asns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_quotation_id_documents_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_estimates" ADD CONSTRAINT "cpq_estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_option_groups" ADD CONSTRAINT "cpq_option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_option_groups" ADD CONSTRAINT "cpq_option_groups_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpq_quote_templates" ADD CONSTRAINT "cpq_quote_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedule_lines" ADD CONSTRAINT "customer_schedule_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedule_lines" ADD CONSTRAINT "customer_schedule_lines_schedule_id_customer_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."customer_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asns_number_uq" ON "asns" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "asns_delivery_uq" ON "asns" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cpq_estimates_number_uq" ON "cpq_estimates" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "cpq_estimates_party_idx" ON "cpq_estimates" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cpq_option_groups_uq" ON "cpq_option_groups" USING btree ("item_id","code");--> statement-breakpoint
CREATE INDEX "customer_schedule_lines_idx" ON "customer_schedule_lines" USING btree ("schedule_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_schedules_rev_uq" ON "customer_schedules" USING btree ("tenant_id","customer_id","item_id","month","revision");--> statement-breakpoint
CREATE INDEX "customer_schedules_month_idx" ON "customer_schedules" USING btree ("tenant_id","month");