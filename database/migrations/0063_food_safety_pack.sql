CREATE TABLE "ccp_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"ccp_id" text NOT NULL,
	"value" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"ok" boolean NOT NULL,
	"batch_no" text,
	"corrective_action" text,
	"product_held" boolean DEFAULT false NOT NULL,
	"signal_id" uuid,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "compliance_certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"issuer" text,
	"scope" text,
	"valid_from" date,
	"valid_until" date,
	"url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"veg_mark" text NOT NULL,
	"ingredients" text NOT NULL,
	"nutrition" jsonb NOT NULL,
	"serving_size_g" double precision,
	"net_quantity" text,
	"storage" text,
	"fssai_licence_no" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "haccp_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"title" text NOT NULL,
	"item_id" uuid,
	"scope" text,
	"team" text,
	"version" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hazards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ccps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_signature_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_allergens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"contains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recalls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"reason" text NOT NULL,
	"recall_class" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_completed_at" timestamp with time zone,
	"trace" jsonb,
	"recovered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"conclusion" text,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ccp_records" ADD CONSTRAINT "ccp_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ccp_records" ADD CONSTRAINT "ccp_records_plan_id_haccp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."haccp_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ccp_records" ADD CONSTRAINT "ccp_records_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ccp_records" ADD CONSTRAINT "ccp_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_labels" ADD CONSTRAINT "food_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_labels" ADD CONSTRAINT "food_labels_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "haccp_plans" ADD CONSTRAINT "haccp_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "haccp_plans" ADD CONSTRAINT "haccp_plans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "haccp_plans" ADD CONSTRAINT "haccp_plans_approval_signature_id_e_signatures_id_fk" FOREIGN KEY ("approval_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "haccp_plans" ADD CONSTRAINT "haccp_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_allergens" ADD CONSTRAINT "item_allergens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_allergens" ADD CONSTRAINT "item_allergens_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ccp_records_idx" ON "ccp_records" USING btree ("tenant_id","plan_id","recorded_at");--> statement-breakpoint
CREATE INDEX "compliance_certificates_idx" ON "compliance_certificates" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "compliance_certificates_expiry_idx" ON "compliance_certificates" USING btree ("tenant_id","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "food_labels_item_uq" ON "food_labels" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "haccp_plans_code_uq" ON "haccp_plans" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "item_allergens_uq" ON "item_allergens" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recalls_code_uq" ON "recalls" USING btree ("tenant_id","code");