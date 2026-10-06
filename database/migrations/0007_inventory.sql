CREATE TYPE "public"."serial_status" AS ENUM('in_stock', 'consumed', 'delivered', 'scrapped');--> statement-breakpoint
CREATE TYPE "public"."stock_entry_purpose" AS ENUM('opening_stock', 'material_receipt', 'material_issue', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" "citext" NOT NULL,
	"mfg_date" date,
	"expiry_date" date,
	"supplier_batch_no" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_numbers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" "citext" NOT NULL,
	"status" serial_status NOT NULL,
	"warehouse_id" uuid,
	"last_voucher_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_key" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_item_id_warehouse_id_batch_key_pk" PRIMARY KEY("item_id","warehouse_id","batch_key")
);
--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" "stock_entry_purpose" NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"reason" text,
	"reference" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "stock_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4),
	"amount" numeric(18, 2),
	"batch_no" text,
	"mfg_date" date,
	"expiry_date" date,
	"serial_nos" text[],
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid,
	"serial_nos" text[],
	"qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"balance_qty" numeric(18, 4) NOT NULL,
	"balance_value" numeric(18, 2) NOT NULL,
	"valuation_rate" numeric(18, 6) NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_id" uuid NOT NULL,
	"voucher_number" text,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_valuation" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_valuation_item_id_warehouse_id_pk" PRIMARY KEY("item_id","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_lines" ADD CONSTRAINT "stock_entry_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_lines" ADD CONSTRAINT "stock_entry_lines_entry_id_stock_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_lines" ADD CONSTRAINT "stock_entry_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_lines" ADD CONSTRAINT "stock_entry_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_voucher_id_documents_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuation" ADD CONSTRAINT "stock_valuation_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuation" ADD CONSTRAINT "stock_valuation_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuation" ADD CONSTRAINT "stock_valuation_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_item_no_uq" ON "batches" USING btree ("tenant_id","item_id","batch_no");--> statement-breakpoint
CREATE INDEX "batches_expiry_idx" ON "batches" USING btree ("tenant_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "serials_item_no_uq" ON "serial_numbers" USING btree ("tenant_id","item_id","serial_no");--> statement-breakpoint
CREATE INDEX "serials_wh_idx" ON "serial_numbers" USING btree ("tenant_id","item_id","warehouse_id","status");--> statement-breakpoint
CREATE INDEX "stock_balances_tenant_item_idx" ON "stock_balances" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_entry_lines_entry_idx" ON "stock_entry_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_entry_lines_no_uq" ON "stock_entry_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_wh_idx" ON "stock_ledger" USING btree ("tenant_id","item_id","warehouse_id","id");--> statement-breakpoint
CREATE INDEX "stock_ledger_voucher_idx" ON "stock_ledger" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_date_idx" ON "stock_ledger" USING btree ("tenant_id","posting_date");--> statement-breakpoint
CREATE INDEX "stock_ledger_batch_idx" ON "stock_ledger" USING btree ("batch_id") WHERE "stock_ledger"."batch_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_valuation_tenant_idx" ON "stock_valuation" USING btree ("tenant_id");