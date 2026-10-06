CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"invoice_line_id" uuid NOT NULL,
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
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"warehouse_id" uuid,
	"reason" text NOT NULL,
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
CREATE TABLE "delivery_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"so_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"batch_no" text,
	"serial_nos" text[],
	"cost_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"invoiced_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transporter" text,
	"transporter_gstin" char(15),
	"vehicle_no" text,
	"lr_no" text,
	"lr_date" date,
	"distance_km" integer,
	"packages" integer,
	"gross_weight_kg" numeric(12, 3),
	"net_weight_kg" numeric(12, 3),
	"delivered_at" timestamp with time zone,
	"pod_note" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"list_rate" numeric(18, 4),
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
	"unit_cost" numeric(18, 4),
	"remarks" text,
	"so_line_id" uuid,
	"dlv_line_id" uuid,
	"batch_no" text,
	"serial_nos" text[],
	"cost_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_gstin" char(15),
	"customer_state_code" char(2),
	"customer_registration" text NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"with_lut" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"customer_po_no" text,
	"customer_po_date" date,
	"warehouse_id" uuid,
	"payment_terms" text,
	"credit_days" integer,
	"due_date" date,
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
	"cost_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"received_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"transporter" text,
	"vehicle_no" text,
	"lr_no" text,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"signed_qr" text,
	"eway_bill_no" text,
	"eway_bill_date" timestamp with time zone,
	"eway_valid_until" timestamp with time zone,
	"terms" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"list_rate" numeric(18, 4),
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
	"unit_cost" numeric(18, 4),
	"remarks" text,
	"delivery_date" date,
	"quotation_line_id" uuid,
	"delivered_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"invoiced_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_gstin" char(15),
	"customer_state_code" char(2),
	"customer_registration" text NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"with_lut" boolean DEFAULT false NOT NULL,
	"quotation_id" uuid,
	"customer_po_no" text,
	"customer_po_date" date,
	"warehouse_id" uuid,
	"expected_date" date,
	"price_list_id" uuid,
	"payment_terms" text,
	"credit_days" integer,
	"terms" text,
	"notes" text,
	"cost_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(7, 2),
	"max_discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
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
	"credit_check" jsonb,
	"credit_override_reason" text,
	"closed_at" timestamp with time zone,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "sales_quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_qty" numeric(18, 4) NOT NULL,
	"list_rate" numeric(18, 4),
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
	"unit_cost" numeric(18, 4),
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "sales_quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_gstin" char(15),
	"customer_state_code" char(2),
	"customer_registration" text NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"with_lut" boolean DEFAULT false NOT NULL,
	"valid_until" date,
	"customer_enquiry_ref" text,
	"price_list_id" uuid,
	"payment_terms" text,
	"credit_days" integer,
	"terms" text,
	"notes" text,
	"cost_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(7, 2),
	"max_discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
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
	"tax_notes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "condition_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_sales_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."sales_invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_dlv_line_id_delivery_note_lines_id_fk" FOREIGN KEY ("dlv_line_id") REFERENCES "public"."delivery_note_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_quotation_line_id_sales_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."sales_quotation_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cn_lines_cn_idx" ON "credit_note_lines" USING btree ("credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cn_lines_no_uq" ON "credit_note_lines" USING btree ("credit_note_id","line_no");--> statement-breakpoint
CREATE INDEX "cn_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "dlv_lines_d_idx" ON "delivery_note_lines" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dlv_lines_no_uq" ON "delivery_note_lines" USING btree ("delivery_id","line_no");--> statement-breakpoint
CREATE INDEX "dlv_lines_so_idx" ON "delivery_note_lines" USING btree ("so_line_id");--> statement-breakpoint
CREATE INDEX "dlv_order_idx" ON "delivery_notes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "si_lines_i_idx" ON "sales_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "si_lines_no_uq" ON "sales_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "si_lines_dlv_idx" ON "sales_invoice_lines" USING btree ("dlv_line_id");--> statement-breakpoint
CREATE INDEX "si_customer_idx" ON "sales_invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "si_due_idx" ON "sales_invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "so_lines_o_idx" ON "sales_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "so_lines_no_uq" ON "sales_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "so_lines_item_idx" ON "sales_order_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "so_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "sq_lines_q_idx" ON "sales_quotation_lines" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sq_lines_no_uq" ON "sales_quotation_lines" USING btree ("quotation_id","line_no");--> statement-breakpoint
CREATE INDEX "sq_customer_idx" ON "sales_quotations" USING btree ("tenant_id","customer_id");