CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"clause" text,
	"description" text NOT NULL,
	"capa_id" uuid,
	"closed_on" date
);
--> statement-breakpoint
CREATE TABLE "calibrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gauge_id" uuid NOT NULL,
	"calibrated_on" date NOT NULL,
	"calibrated_by" text NOT NULL,
	"certificate_no" text,
	"result" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_due" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"item_id" uuid,
	"batch_no" text,
	"work_order_id" uuid,
	"impact" text,
	"severity" smallint NOT NULL,
	"occurrence" smallint NOT NULL,
	"detection" smallint NOT NULL,
	"rpn" smallint NOT NULL,
	"risk_level" text NOT NULL,
	"product_impact" boolean DEFAULT false NOT NULL,
	"proposed_action" text,
	"valid_until" date,
	"capa_id" uuid,
	"closed_at" timestamp with time zone,
	"closure_notes" text
);
--> statement-breakpoint
CREATE TABLE "epr_obligations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"target_kg" numeric(18, 3) NOT NULL,
	"achieved_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"certificates" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "gauges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"make" text,
	"serial_no" text,
	"range" text,
	"least_count" text,
	"location" text,
	"owner" text,
	"calibration_source" text DEFAULT 'external' NOT NULL,
	"interval_days" integer DEFAULT 365 NOT NULL,
	"acceptance" text,
	"last_calibrated" date,
	"next_due" date,
	"status" text DEFAULT 'in_use' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grr_studies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gauge_id" uuid NOT NULL,
	"study_date" date NOT NULL,
	"characteristic" text NOT NULL,
	"tolerance" numeric(18, 6),
	"operators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"measurements" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazardous_waste" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"qty" numeric(18, 3) NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"generated_on" date NOT NULL,
	"stored_at" text,
	"disposed_on" date,
	"disposal_agency" text,
	"manifest_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hse_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"person_involved" text,
	"lost_days" integer DEFAULT 0 NOT NULL,
	"immediate_action" text,
	"root_cause" text,
	"capa_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"reported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"standard" text NOT NULL,
	"area" text NOT NULL,
	"planned_date" date NOT NULL,
	"auditor" text NOT NULL,
	"auditee" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"done_on" date,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"authority" text NOT NULL,
	"number" text,
	"issued_on" date,
	"valid_until" date,
	"renewal_lead_days" integer DEFAULT 60 NOT NULL,
	"owner" text,
	"notes" text,
	"party_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_trainees" (
	"tenant_id" uuid NOT NULL,
	"sop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sop_code" "citext" NOT NULL,
	"sop_version" smallint DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"department" text,
	"purpose" text,
	"body" text,
	"effective_date" date,
	"review_due" date,
	"previous_id" uuid,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "severity" smallint;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "occurrence" smallint;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "detection" smallint;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "rpn" smallint;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "regulatory_impact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD COLUMN "validation_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_internal_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."internal_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_gauge_id_gauges_id_fk" FOREIGN KEY ("gauge_id") REFERENCES "public"."gauges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_obligations" ADD CONSTRAINT "epr_obligations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauges" ADD CONSTRAINT "gauges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grr_studies" ADD CONSTRAINT "grr_studies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grr_studies" ADD CONSTRAINT "grr_studies_gauge_id_gauges_id_fk" FOREIGN KEY ("gauge_id") REFERENCES "public"."gauges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grr_studies" ADD CONSTRAINT "grr_studies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazardous_waste" ADD CONSTRAINT "hazardous_waste_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_audits" ADD CONSTRAINT "internal_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licences" ADD CONSTRAINT "licences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licences" ADD CONSTRAINT "licences_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_trainees" ADD CONSTRAINT "sop_trainees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_trainees" ADD CONSTRAINT "sop_trainees_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_trainees" ADD CONSTRAINT "sop_trainees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_previous_id_sops_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."sops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_findings_audit_idx" ON "audit_findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "calibrations_gauge_idx" ON "calibrations" USING btree ("gauge_id","calibrated_on");--> statement-breakpoint
CREATE INDEX "deviations_item_idx" ON "deviations" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_uq" ON "epr_obligations" USING btree ("tenant_id","category","fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "gauges_code_uq" ON "gauges" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "gauges_due_idx" ON "gauges" USING btree ("tenant_id","next_due");--> statement-breakpoint
CREATE INDEX "grr_gauge_idx" ON "grr_studies" USING btree ("gauge_id");--> statement-breakpoint
CREATE INDEX "hazardous_waste_date_idx" ON "hazardous_waste" USING btree ("tenant_id","generated_on");--> statement-breakpoint
CREATE INDEX "hse_incidents_date_idx" ON "hse_incidents" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "internal_audits_date_idx" ON "internal_audits" USING btree ("tenant_id","planned_date");--> statement-breakpoint
CREATE INDEX "licences_expiry_idx" ON "licences" USING btree ("tenant_id","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_trainees_uq" ON "sop_trainees" USING btree ("sop_id","user_id");--> statement-breakpoint
CREATE INDEX "sop_trainees_user_idx" ON "sop_trainees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sops_code_version_uq" ON "sops" USING btree ("tenant_id","sop_code","sop_version");