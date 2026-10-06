CREATE TYPE "public"."po_type" AS ENUM('standard', 'service');--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grn_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"po_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"received_qty" numeric(18, 4) NOT NULL,
	"rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"accepted_qty" numeric(18, 4) NOT NULL,
	"accepted_base_qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"batch_no" text,
	"mfg_date" date,
	"expiry_date" date,
	"serial_nos" text[],
	"rejection_reason" text,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_invoice_no" text,
	"supplier_invoice_date" date,
	"challan_no" text,
	"gate_entry_no" text,
	"vehicle_no" text,
	"transporter" text,
	"lr_no" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
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
	"delivery_date" date,
	"requisition_line_id" uuid,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"po_type" "po_type" DEFAULT 'standard' NOT NULL,
	"vendor_id" uuid NOT NULL,
	"vendor_gstin" char(15),
	"vendor_state_code" char(2),
	"vendor_registration" text NOT NULL,
	"vendor_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivery_warehouse_id" uuid,
	"expected_date" date,
	"vendor_quote_ref" text,
	"payment_terms" text,
	"credit_days" integer,
	"tolerance_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"terms" text,
	"notes" text,
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
	"closed_at" timestamp with time zone,
	"close_reason" text
);
--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD COLUMN "ordered_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requisition_line_id_purchase_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."purchase_requisition_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_warehouse_id_warehouses_id_fk" FOREIGN KEY ("delivery_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grn_lines_grn_idx" ON "goods_receipt_lines" USING btree ("grn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grn_lines_no_uq" ON "goods_receipt_lines" USING btree ("grn_id","line_no");--> statement-breakpoint
CREATE INDEX "grn_lines_po_line_idx" ON "goods_receipt_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "grn_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "grn_vendor_idx" ON "goods_receipts" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "po_lines_po_idx" ON "purchase_order_lines" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_lines_no_uq" ON "purchase_order_lines" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE INDEX "po_lines_item_idx" ON "purchase_order_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_vendor_idx" ON "purchase_orders" USING btree ("tenant_id","vendor_id");