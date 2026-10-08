CREATE TABLE "hazmat_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"hazard_class" text NOT NULL,
	"max_kg" double precision NOT NULL,
	"licence_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sds_distributions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sds_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"via" text DEFAULT 'email' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sds_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ghs" jsonb NOT NULL,
	"un_number" text,
	"hazard_class" text,
	"packing_group" text,
	"petroleum_class" text,
	"flash_point_c" double precision,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_permits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" "citext" NOT NULL,
	"type" text NOT NULL,
	"location" text NOT NULL,
	"equipment" text,
	"description" text NOT NULL,
	"contractor" text,
	"workers" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isolations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gas_tests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"approval_signature_id" uuid,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"po_no" text NOT NULL,
	"tech_pack_id" uuid NOT NULL,
	"breakdown" jsonb NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"po_date" date NOT NULL,
	"ex_factory" date NOT NULL,
	"incoterm" text,
	"sales_order_id" uuid,
	"milestones" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid,
	"standard" text NOT NULL,
	"audited_on" date NOT NULL,
	"auditor" text,
	"rating" text,
	"critical_findings" integer DEFAULT 0 NOT NULL,
	"major_findings" integer DEFAULT 0 NOT NULL,
	"minor_findings" integer DEFAULT 0 NOT NULL,
	"valid_until" date,
	"cap_due_on" date,
	"cap_status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_samples" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tech_pack_id" uuid NOT NULL,
	"type" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"colour" text,
	"size" text,
	"sent_on" date,
	"courier_ref" text,
	"measured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"buyer_comments" text,
	"decided_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_packs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"style_no" "citext" NOT NULL,
	"buyer_id" uuid,
	"season" text,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sizes" text[] DEFAULT '{}' NOT NULL,
	"colours" text[] DEFAULT '{}' NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"measurements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"construction" text,
	"required_certificates" text[] DEFAULT '{}' NOT NULL,
	"item_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emission_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" date NOT NULL,
	"factor_id" uuid NOT NULL,
	"quantity" double precision NOT NULL,
	"site" text,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emission_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"scope" smallint NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"kg_co2e_per_unit" double precision NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "epr_certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"sub_category" text,
	"kind" text DEFAULT 'recycling' NOT NULL,
	"number" text NOT NULL,
	"issuer_id" uuid,
	"issuer_name" text,
	"qty_kg" double precision NOT NULL,
	"issued_on" date NOT NULL,
	"amount" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esg_metrics" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year" text NOT NULL,
	"key" text NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_declarations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_id" uuid,
	"rohs" text DEFAULT 'unknown' NOT NULL,
	"rohs_exemptions" text[] DEFAULT '{}' NOT NULL,
	"svhc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reach_candidate_list_version" text,
	"uses_3tg" boolean DEFAULT false NOT NULL,
	"smelters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cmrt_version" text,
	"bis_required" boolean DEFAULT false NOT NULL,
	"declared_on" date,
	"valid_until" date,
	"document_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hazmat_limits" ADD CONSTRAINT "hazmat_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazmat_limits" ADD CONSTRAINT "hazmat_limits_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazmat_limits" ADD CONSTRAINT "hazmat_limits_licence_id_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."licences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_distributions" ADD CONSTRAINT "sds_distributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_distributions" ADD CONSTRAINT "sds_distributions_sds_id_sds_documents_id_fk" FOREIGN KEY ("sds_id") REFERENCES "public"."sds_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_distributions" ADD CONSTRAINT "sds_distributions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_distributions" ADD CONSTRAINT "sds_distributions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_documents" ADD CONSTRAINT "sds_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_documents" ADD CONSTRAINT "sds_documents_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sds_documents" ADD CONSTRAINT "sds_documents_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_approval_signature_id_e_signatures_id_fk" FOREIGN KEY ("approval_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_buyer_id_parties_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_tech_pack_id_tech_packs_id_fk" FOREIGN KEY ("tech_pack_id") REFERENCES "public"."tech_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_orders" ADD CONSTRAINT "buyer_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_audits" ADD CONSTRAINT "social_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_audits" ADD CONSTRAINT "social_audits_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_samples" ADD CONSTRAINT "style_samples_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_samples" ADD CONSTRAINT "style_samples_tech_pack_id_tech_packs_id_fk" FOREIGN KEY ("tech_pack_id") REFERENCES "public"."tech_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_samples" ADD CONSTRAINT "style_samples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_buyer_id_parties_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_packs" ADD CONSTRAINT "tech_packs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_factor_id_emission_factors_id_fk" FOREIGN KEY ("factor_id") REFERENCES "public"."emission_factors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_entries" ADD CONSTRAINT "emission_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emission_factors" ADD CONSTRAINT "emission_factors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_certificates" ADD CONSTRAINT "epr_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_certificates" ADD CONSTRAINT "epr_certificates_issuer_id_parties_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_metrics" ADD CONSTRAINT "esg_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_declarations" ADD CONSTRAINT "part_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_declarations" ADD CONSTRAINT "part_declarations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_declarations" ADD CONSTRAINT "part_declarations_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hazmat_limits_uq" ON "hazmat_limits" USING btree ("tenant_id","warehouse_id","hazard_class");--> statement-breakpoint
CREATE INDEX "sds_distributions_party_idx" ON "sds_distributions" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sds_item_version_uq" ON "sds_documents" USING btree ("tenant_id","item_id","language","version");--> statement-breakpoint
CREATE UNIQUE INDEX "work_permits_number_uq" ON "work_permits" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "work_permits_valid_idx" ON "work_permits" USING btree ("tenant_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_orders_po_uq" ON "buyer_orders" USING btree ("tenant_id","buyer_id","po_no");--> statement-breakpoint
CREATE INDEX "buyer_orders_exf_idx" ON "buyer_orders" USING btree ("tenant_id","ex_factory");--> statement-breakpoint
CREATE INDEX "social_audits_party_idx" ON "social_audits" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "style_samples_pack_idx" ON "style_samples" USING btree ("tenant_id","tech_pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_packs_style_uq" ON "tech_packs" USING btree ("tenant_id","style_no");--> statement-breakpoint
CREATE INDEX "emission_entries_period_idx" ON "emission_entries" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "emission_factors_key_uq" ON "emission_factors" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_certificates_number_uq" ON "epr_certificates" USING btree ("tenant_id","category","number");--> statement-breakpoint
CREATE INDEX "epr_certificates_year_idx" ON "epr_certificates" USING btree ("tenant_id","fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "esg_metrics_uq" ON "esg_metrics" USING btree ("tenant_id","fiscal_year","key");--> statement-breakpoint
CREATE UNIQUE INDEX "part_declarations_item_uq" ON "part_declarations" USING btree ("tenant_id","item_id");