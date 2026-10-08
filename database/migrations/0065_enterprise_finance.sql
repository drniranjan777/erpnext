CREATE TABLE "allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_cost_center_id" uuid NOT NULL,
	"account_ids" uuid[] DEFAULT '{}' NOT NULL,
	"targets" jsonb NOT NULL,
	"basis" text DEFAULT 'percent' NOT NULL,
	"runs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sequence" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consolidation_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_company_id" uuid NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intercompany_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intercompany_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" "citext" NOT NULL,
	"txn_date" date NOT NULL,
	"from_company_id" uuid NOT NULL,
	"to_company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"description" text NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"from_journal_id" uuid,
	"to_journal_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_instruments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"bank" text NOT NULL,
	"principal" double precision NOT NULL,
	"rate_pct" double precision DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"method" text,
	"facility_id" uuid,
	"margin_pct" double precision DEFAULT 0 NOT NULL,
	"beneficiary" text,
	"purpose" text,
	"status" text DEFAULT 'active' NOT NULL,
	"accruals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_source_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("source_cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_groups" ADD CONSTRAINT "consolidation_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_groups" ADD CONSTRAINT "consolidation_groups_parent_company_id_companies_id_fk" FOREIGN KEY ("parent_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_links" ADD CONSTRAINT "intercompany_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_links" ADD CONSTRAINT "intercompany_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_links" ADD CONSTRAINT "intercompany_links_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_from_company_id_companies_id_fk" FOREIGN KEY ("from_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_to_company_id_companies_id_fk" FOREIGN KEY ("to_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_from_journal_id_documents_id_fk" FOREIGN KEY ("from_journal_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_to_journal_id_documents_id_fk" FOREIGN KEY ("to_journal_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transactions" ADD CONSTRAINT "intercompany_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_instruments" ADD CONSTRAINT "treasury_instruments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_instruments" ADD CONSTRAINT "treasury_instruments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_links_company_uq" ON "intercompany_links" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_links_party_uq" ON "intercompany_links" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_txn_number_uq" ON "intercompany_transactions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "intercompany_txn_date_idx" ON "intercompany_transactions" USING btree ("tenant_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_number_uq" ON "treasury_instruments" USING btree ("tenant_id","company_id","kind","number");--> statement-breakpoint
CREATE INDEX "treasury_end_idx" ON "treasury_instruments" USING btree ("tenant_id","end_date");