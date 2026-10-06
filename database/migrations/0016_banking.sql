CREATE TABLE "bank_reconciliations" (
	"gl_entry_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"statement_line_id" uuid NOT NULL,
	"cleared_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"txn_date" date NOT NULL,
	"value_date" date,
	"description" text NOT NULL,
	"reference" text,
	"withdrawal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deposit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(18, 2),
	"status" text DEFAULT 'unmatched' NOT NULL,
	"matched_by" text,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"against_doc_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"adjustment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"party_id" uuid,
	"account_id" uuid NOT NULL,
	"counter_account_id" uuid,
	"mode" text DEFAULT 'neft' NOT NULL,
	"instrument_no" text,
	"instrument_date" date,
	"cheque_status" text,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bank_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tds_deducted" numeric(18, 2) DEFAULT '0' NOT NULL,
	"settled_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"on_account" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reference" text,
	"narration" text
);
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "debited_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "bank_account_no" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "bank_ifsc" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_gl_entry_id_gl_entries_id_fk" FOREIGN KEY ("gl_entry_id") REFERENCES "public"."gl_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_statement_line_id_bank_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "public"."bank_statement_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_voucher_id_money_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."money_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_against_doc_id_documents_id_fk" FOREIGN KEY ("against_doc_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_adjustment_id_documents_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_vouchers" ADD CONSTRAINT "money_vouchers_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_vouchers" ADD CONSTRAINT "money_vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_vouchers" ADD CONSTRAINT "money_vouchers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_vouchers" ADD CONSTRAINT "money_vouchers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_vouchers" ADD CONSTRAINT "money_vouchers_counter_account_id_accounts_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "br_line_idx" ON "bank_reconciliations" USING btree ("statement_line_id");--> statement-breakpoint
CREATE INDEX "br_tenant_idx" ON "bank_reconciliations" USING btree ("tenant_id") WHERE true;--> statement-breakpoint
CREATE INDEX "bsl_account_idx" ON "bank_statement_lines" USING btree ("tenant_id","account_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bsl_import_line_uq" ON "bank_statement_lines" USING btree ("import_id","line_no");--> statement-breakpoint
CREATE INDEX "ma_voucher_idx" ON "money_allocations" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "ma_against_idx" ON "money_allocations" USING btree ("against_doc_id");--> statement-breakpoint
CREATE INDEX "mv_party_idx" ON "money_vouchers" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "mv_account_idx" ON "money_vouchers" USING btree ("tenant_id","account_id");