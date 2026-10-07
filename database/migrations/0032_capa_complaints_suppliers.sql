CREATE TABLE "approved_manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"manufacturer" text NOT NULL,
	"mpn" text DEFAULT '' NOT NULL,
	"party_id" uuid,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_on" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "capa_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capa_id" uuid NOT NULL,
	"kind" text DEFAULT 'corrective' NOT NULL,
	"action" text NOT NULL,
	"owner" text,
	"due_date" date,
	"done_on" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "capas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'corrective' NOT NULL,
	"source" text NOT NULL,
	"ncr_id" uuid,
	"complaint_id" uuid,
	"item_id" uuid,
	"is_scar" boolean DEFAULT false NOT NULL,
	"party_id" uuid,
	"response_due" date,
	"problem" text NOT NULL,
	"method" text DEFAULT '5why' NOT NULL,
	"whys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fishbone" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eight_d" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"root_cause" text,
	"stage" text DEFAULT 'open' NOT NULL,
	"effectiveness_due" date,
	"effectiveness_result" text,
	"effectiveness_notes" text,
	"verified_by" uuid,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_complaints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"item_id" uuid,
	"batch_no" text,
	"qty" numeric(18, 4),
	"ref_doc_id" uuid,
	"received_on" date NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'major' NOT NULL,
	"description" text NOT NULL,
	"is_field_failure" boolean DEFAULT false NOT NULL,
	"warranty_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"response_due" date,
	"stage" text DEFAULT 'open' NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"ncr_id" uuid,
	"capa_id" uuid,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"audit_date" date NOT NULL,
	"kind" text DEFAULT 'system' NOT NULL,
	"auditor" text NOT NULL,
	"score" numeric(5, 1),
	"result" text NOT NULL,
	"findings" text,
	"next_due" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approved_manufacturers" ADD CONSTRAINT "approved_manufacturers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_manufacturers" ADD CONSTRAINT "approved_manufacturers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_manufacturers" ADD CONSTRAINT "approved_manufacturers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_complaint_id_customer_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."customer_complaints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_ref_doc_id_documents_id_fk" FOREIGN KEY ("ref_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_ncr_id_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncrs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_audits" ADD CONSTRAINT "supplier_audits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aml_uq" ON "approved_manufacturers" USING btree ("item_id","manufacturer","mpn");--> statement-breakpoint
CREATE INDEX "capa_actions_capa_idx" ON "capa_actions" USING btree ("capa_id");--> statement-breakpoint
CREATE INDEX "capas_ncr_idx" ON "capas" USING btree ("ncr_id");--> statement-breakpoint
CREATE INDEX "capas_party_idx" ON "capas" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "complaints_customer_idx" ON "customer_complaints" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "complaints_item_idx" ON "customer_complaints" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "supplier_audits_party_idx" ON "supplier_audits" USING btree ("tenant_id","party_id","audit_date");