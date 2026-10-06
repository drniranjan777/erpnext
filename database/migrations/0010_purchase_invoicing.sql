CREATE TYPE "public"."allocation_method" AS ENUM('value', 'qty', 'weight');--> statement-breakpoint
CREATE TYPE "public"."debit_note_kind" AS ENUM('return', 'price_adjustment');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('three_way', 'two_way', 'none');--> statement-breakpoint
CREATE TABLE "debit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dn_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"pi_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxability" text DEFAULT 'taxable' NOT NULL,
	"taxable_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"batch_no" text,
	"serial_nos" text[],
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "debit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pi_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"kind" "debit_note_kind" NOT NULL,
	"warehouse_id" uuid,
	"reason" text NOT NULL,
	"vehicle_no" text,
	"place_of_supply" char(2),
	"inter_state" boolean DEFAULT false NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"tax_kind" text DEFAULT 'tax_invoice' NOT NULL,
	"taxable_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reverse_charge_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "item_vendors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"is_approved" boolean DEFAULT true NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"vendor_item_code" text,
	"lead_time_days" integer,
	"min_order_qty" numeric(18, 4),
	"last_rate" numeric(18, 4),
	"last_ordered_at" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "landed_cost_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"landed_cost_id" uuid NOT NULL,
	"grn_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"basis" numeric(18, 4) NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"absorbed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unabsorbed" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"landed_cost_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"charge_type" text NOT NULL,
	"description" text,
	"vendor_id" uuid,
	"bill_ref" text,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_receipts" (
	"tenant_id" uuid NOT NULL,
	"landed_cost_id" uuid NOT NULL,
	"grn_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_costs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"method" "allocation_method" DEFAULT 'value' NOT NULL,
	"total_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unabsorbed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pi_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxability" text DEFAULT 'taxable' NOT NULL,
	"taxable_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"itc_eligible" boolean DEFAULT true NOT NULL,
	"po_line_id" uuid,
	"grn_line_id" uuid,
	"expected_rate" numeric(18, 4),
	"rate_variance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"vendor_gstin" char(15),
	"vendor_state_code" char(2),
	"vendor_registration" text NOT NULL,
	"vendor_msme" text,
	"supplier_invoice_no" text NOT NULL,
	"supplier_invoice_date" date NOT NULL,
	"po_id" uuid,
	"match_type" "match_type" DEFAULT 'none' NOT NULL,
	"place_of_supply" char(2),
	"inter_state" boolean DEFAULT false NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"tax_kind" text DEFAULT 'tax_invoice' NOT NULL,
	"taxable_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cgst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reverse_charge_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"itc_eligible_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"itc_ineligible_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tds_section" text,
	"tds_rate" numeric(5, 3) DEFAULT '0' NOT NULL,
	"tds_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"rate_tolerance_pct" numeric(5, 2) DEFAULT '1' NOT NULL,
	"rate_variance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"variance_note" text,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfq_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"required_by" date,
	"requisition_line_id" uuid,
	"awarded_vendor_id" uuid,
	"po_id" uuid
);
--> statement-breakpoint
CREATE TABLE "rfq_quotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rfq_vendor_id" uuid NOT NULL,
	"rfq_line_id" uuid NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2),
	"lead_time_days" integer,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "rfq_vendors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"quote_ref" text,
	"quote_date" date,
	"valid_until" date,
	"payment_terms" text,
	"credit_days" integer,
	"delivery_terms" text,
	"other_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_due_date" date,
	"delivery_warehouse_id" uuid,
	"terms" text,
	"notes" text,
	"awarded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "billed_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "billed_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_dn_id_debit_notes_id_fk" FOREIGN KEY ("dn_id") REFERENCES "public"."debit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_pi_line_id_purchase_invoice_lines_id_fk" FOREIGN KEY ("pi_line_id") REFERENCES "public"."purchase_invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_landed_cost_id_landed_costs_id_fk" FOREIGN KEY ("landed_cost_id") REFERENCES "public"."landed_costs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_grn_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("grn_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_landed_cost_id_landed_costs_id_fk" FOREIGN KEY ("landed_cost_id") REFERENCES "public"."landed_costs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charges" ADD CONSTRAINT "landed_cost_charges_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_receipts" ADD CONSTRAINT "landed_cost_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_receipts" ADD CONSTRAINT "landed_cost_receipts_landed_cost_id_landed_costs_id_fk" FOREIGN KEY ("landed_cost_id") REFERENCES "public"."landed_costs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_receipts" ADD CONSTRAINT "landed_cost_receipts_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_pi_id_purchase_invoices_id_fk" FOREIGN KEY ("pi_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_grn_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("grn_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_requisition_line_id_purchase_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."purchase_requisition_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_awarded_vendor_id_parties_id_fk" FOREIGN KEY ("awarded_vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_rfq_vendor_id_rfq_vendors_id_fk" FOREIGN KEY ("rfq_vendor_id") REFERENCES "public"."rfq_vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_rfq_line_id_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."rfq_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_delivery_warehouse_id_warehouses_id_fk" FOREIGN KEY ("delivery_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dn_lines_dn_idx" ON "debit_note_lines" USING btree ("dn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dn_lines_no_uq" ON "debit_note_lines" USING btree ("dn_id","line_no");--> statement-breakpoint
CREATE INDEX "dn_pi_idx" ON "debit_notes" USING btree ("pi_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_vendors_uq" ON "item_vendors" USING btree ("tenant_id","item_id","vendor_id");--> statement-breakpoint
CREATE INDEX "item_vendors_vendor_idx" ON "item_vendors" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "lc_alloc_lc_idx" ON "landed_cost_allocations" USING btree ("landed_cost_id");--> statement-breakpoint
CREATE INDEX "lc_charges_lc_idx" ON "landed_cost_charges" USING btree ("landed_cost_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lc_receipts_uq" ON "landed_cost_receipts" USING btree ("landed_cost_id","grn_id");--> statement-breakpoint
CREATE INDEX "lc_receipts_grn_idx" ON "landed_cost_receipts" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX "pi_lines_pi_idx" ON "purchase_invoice_lines" USING btree ("pi_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pi_lines_no_uq" ON "purchase_invoice_lines" USING btree ("pi_id","line_no");--> statement-breakpoint
CREATE INDEX "pi_lines_grn_idx" ON "purchase_invoice_lines" USING btree ("grn_line_id");--> statement-breakpoint
CREATE INDEX "pi_lines_po_idx" ON "purchase_invoice_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "pi_vendor_idx" ON "purchase_invoices" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "pi_supplier_no_idx" ON "purchase_invoices" USING btree ("tenant_id","vendor_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "pi_due_idx" ON "purchase_invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "rfq_lines_rfq_idx" ON "rfq_lines" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_lines_no_uq" ON "rfq_lines" USING btree ("rfq_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_quotes_uq" ON "rfq_quotes" USING btree ("rfq_vendor_id","rfq_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_vendors_uq" ON "rfq_vendors" USING btree ("rfq_id","vendor_id");