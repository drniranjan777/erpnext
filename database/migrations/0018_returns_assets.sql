CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"method" text DEFAULT 'slm' NOT NULL,
	"useful_life_years" numeric(5, 2) NOT NULL,
	"residual_pct" numeric(5, 2) DEFAULT '5' NOT NULL,
	"it_rate_pct" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" smallint NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"location_id" uuid,
	"custodian" text,
	"serial_no" text,
	"purchase_date" date NOT NULL,
	"capitalised_on" date NOT NULL,
	"cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"residual_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"method" text NOT NULL,
	"useful_life_years" numeric(5, 2) NOT NULL,
	"it_rate_pct" numeric(5, 2) NOT NULL,
	"accumulated_depreciation" numeric(18, 2) DEFAULT '0' NOT NULL,
	"depreciated_until" date,
	"source_invoice_id" uuid,
	"capitalisation_journal_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"disposed_on" date,
	"disposal_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"disposal_journal_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstr2b_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"gstin" char(15) NOT NULL,
	"period" char(7) NOT NULL,
	"file_name" text,
	"lines" integer DEFAULT 0 NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstr2b_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"section" text NOT NULL,
	"ctin" char(15),
	"trade_name" text,
	"doc_type" text NOT NULL,
	"doc_no" text NOT NULL,
	"doc_date" date NOT NULL,
	"pos" char(2),
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"itc_available" boolean DEFAULT true NOT NULL,
	"itc_reason" text,
	"taxable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'missing_in_books' NOT NULL,
	"purchase_invoice_id" uuid,
	"difference" text,
	"action" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "tds_challans" (
	"voucher_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section" text NOT NULL,
	"quarter" text NOT NULL,
	"bsr_code" char(7) NOT NULL,
	"challan_serial" text NOT NULL,
	"deposit_date" date NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"interest" numeric(18, 2) DEFAULT '0' NOT NULL,
	"late_fee" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_journal_id_documents_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_location_id_warehouses_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_source_invoice_id_documents_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_capitalisation_journal_id_documents_id_fk" FOREIGN KEY ("capitalisation_journal_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_journal_id_documents_id_fk" FOREIGN KEY ("disposal_journal_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_imports" ADD CONSTRAINT "gstr2b_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_imports" ADD CONSTRAINT "gstr2b_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_lines" ADD CONSTRAINT "gstr2b_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_lines" ADD CONSTRAINT "gstr2b_lines_import_id_gstr2b_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."gstr2b_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstr2b_lines" ADD CONSTRAINT "gstr2b_lines_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_challans" ADD CONSTRAINT "tds_challans_voucher_id_documents_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_challans" ADD CONSTRAINT "tds_challans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_name_uq" ON "asset_categories" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "asset_dep_asset_idx" ON "asset_depreciation" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_dep_journal_idx" ON "asset_depreciation" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_code_uq" ON "fixed_assets" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "fixed_assets_cat_idx" ON "fixed_assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "g2b_imports_idx" ON "gstr2b_imports" USING btree ("tenant_id","company_id","period");--> statement-breakpoint
CREATE INDEX "g2b_lines_import_idx" ON "gstr2b_lines" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "g2b_lines_period_idx" ON "gstr2b_lines" USING btree ("tenant_id","period","ctin");--> statement-breakpoint
CREATE INDEX "tds_challans_q_idx" ON "tds_challans" USING btree ("tenant_id","quarter");