CREATE TABLE "apqp_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"customer_id" uuid,
	"item_id" uuid,
	"customer_part_no" text,
	"program" text,
	"sop_date" date,
	"deliverables" jsonb NOT NULL,
	"gates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"item_id" uuid NOT NULL,
	"fmea_id" uuid,
	"phase" text NOT NULL,
	"revision" smallint DEFAULT 1 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csr_requirements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"reference" text,
	"requirement" text NOT NULL,
	"clause" text,
	"how_met" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edi_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"reference" text,
	"raw" text NOT NULL,
	"parsed" jsonb,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edi_partners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"our_id" text NOT NULL,
	"their_id" text NOT NULL,
	"part_map" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmeas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"item_id" uuid,
	"team" text,
	"revision" smallint DEFAULT 1 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lpa_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"layer" smallint NOT NULL,
	"auditor" uuid,
	"audited_on" date NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lpa_checklists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"area" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppap_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"apqp_project_id" uuid,
	"customer_id" uuid,
	"item_id" uuid NOT NULL,
	"customer_part_no" text,
	"drawing_rev" text,
	"level" smallint NOT NULL,
	"reason" text NOT NULL,
	"elements" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"psw_signature_id" uuid,
	"submitted_at" timestamp with time zone,
	"customer_decision_at" timestamp with time zone,
	"customer_comments" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apqp_projects" ADD CONSTRAINT "apqp_projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apqp_projects" ADD CONSTRAINT "apqp_projects_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apqp_projects" ADD CONSTRAINT "apqp_projects_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apqp_projects" ADD CONSTRAINT "apqp_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plans" ADD CONSTRAINT "control_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plans" ADD CONSTRAINT "control_plans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plans" ADD CONSTRAINT "control_plans_fmea_id_fmeas_id_fk" FOREIGN KEY ("fmea_id") REFERENCES "public"."fmeas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plans" ADD CONSTRAINT "control_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_requirements" ADD CONSTRAINT "csr_requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csr_requirements" ADD CONSTRAINT "csr_requirements_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_messages" ADD CONSTRAINT "edi_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_messages" ADD CONSTRAINT "edi_messages_partner_id_edi_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."edi_partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_partners" ADD CONSTRAINT "edi_partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_partners" ADD CONSTRAINT "edi_partners_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmeas" ADD CONSTRAINT "fmeas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmeas" ADD CONSTRAINT "fmeas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmeas" ADD CONSTRAINT "fmeas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpa_audits" ADD CONSTRAINT "lpa_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpa_audits" ADD CONSTRAINT "lpa_audits_checklist_id_lpa_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."lpa_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpa_audits" ADD CONSTRAINT "lpa_audits_auditor_users_id_fk" FOREIGN KEY ("auditor") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lpa_checklists" ADD CONSTRAINT "lpa_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_apqp_project_id_apqp_projects_id_fk" FOREIGN KEY ("apqp_project_id") REFERENCES "public"."apqp_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_psw_signature_id_e_signatures_id_fk" FOREIGN KEY ("psw_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppap_submissions" ADD CONSTRAINT "ppap_submissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apqp_projects_code_uq" ON "apqp_projects" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "control_plans_code_uq" ON "control_plans" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "csr_customer_idx" ON "csr_requirements" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "edi_messages_idx" ON "edi_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edi_partners_uq" ON "edi_partners" USING btree ("tenant_id","their_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmeas_code_uq" ON "fmeas" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "lpa_audits_idx" ON "lpa_audits" USING btree ("tenant_id","checklist_id","audited_on");--> statement-breakpoint
CREATE INDEX "lpa_checklists_idx" ON "lpa_checklists" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppap_code_uq" ON "ppap_submissions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ppap_item_idx" ON "ppap_submissions" USING btree ("tenant_id","item_id");