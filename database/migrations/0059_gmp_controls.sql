CREATE TABLE "batch_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_id" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "em_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"room" text,
	"grade" text NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "em_samples" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"param" text NOT NULL,
	"value" double precision NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"status" text NOT NULL,
	"condition" text DEFAULT 'in_operation' NOT NULL,
	"work_order_id" uuid,
	"deviation_id" uuid,
	"signal_id" uuid,
	"notes" text,
	"sampled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmp_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"require_line_clearance" boolean DEFAULT false NOT NULL,
	"line_clearance_hours" double precision DEFAULT 12 NOT NULL,
	"line_clearance_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_clearances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"machine_id" uuid,
	"area" text,
	"previous_item_id" uuid,
	"previous_batch" text,
	"checklist" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"production_signature_id" uuid,
	"qa_signature_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "e_signatures" ADD COLUMN "signer_name" text;--> statement-breakpoint
ALTER TABLE "e_signatures" ADD COLUMN "record_hash" text;--> statement-breakpoint
ALTER TABLE "e_signatures" ADD COLUMN "chain_hash" text;--> statement-breakpoint
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_signature_id_e_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reviews" ADD CONSTRAINT "batch_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_locations" ADD CONSTRAINT "em_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_samples" ADD CONSTRAINT "em_samples_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_samples" ADD CONSTRAINT "em_samples_location_id_em_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."em_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_samples" ADD CONSTRAINT "em_samples_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_samples" ADD CONSTRAINT "em_samples_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "em_samples" ADD CONSTRAINT "em_samples_sampled_by_users_id_fk" FOREIGN KEY ("sampled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmp_settings" ADD CONSTRAINT "gmp_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_previous_item_id_items_id_fk" FOREIGN KEY ("previous_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_production_signature_id_e_signatures_id_fk" FOREIGN KEY ("production_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_clearances" ADD CONSTRAINT "line_clearances_qa_signature_id_e_signatures_id_fk" FOREIGN KEY ("qa_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reviews_wo_uq" ON "batch_reviews" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "em_locations_code_uq" ON "em_locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "em_samples_loc_idx" ON "em_samples" USING btree ("tenant_id","location_id","sampled_at");--> statement-breakpoint
CREATE INDEX "em_samples_status_idx" ON "em_samples" USING btree ("tenant_id","status","sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gmp_settings_uq" ON "gmp_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "line_clearances_wo_idx" ON "line_clearances" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE INDEX "line_clearances_machine_idx" ON "line_clearances" USING btree ("tenant_id","machine_id","cleared_at");--> statement-breakpoint
CREATE INDEX "e_signatures_signed_idx" ON "e_signatures" USING btree ("tenant_id","signed_at");