CREATE TABLE "bill_of_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"boe_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"hsn_code" text,
	"qty" numeric(18, 4) NOT NULL,
	"uom_id" uuid NOT NULL,
	"foreign_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"assessable_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bcd_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"bcd_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sws_rate" numeric(5, 2) DEFAULT '10' NOT NULL,
	"sws_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cess_amount" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills_of_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"boe_no" text NOT NULL,
	"boe_date" date NOT NULL,
	"port_code" text NOT NULL,
	"boe_type" text DEFAULT 'home' NOT NULL,
	"purchase_invoice_id" uuid,
	"goods_receipt_id" uuid,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"exchange_rate" numeric(18, 6) NOT NULL,
	"assessable_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bcd_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sws_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cess_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"duty_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"capitalised" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "eway_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ewb_no" text NOT NULL,
	"ewb_date" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"supply_type" char(1) NOT NULL,
	"sub_supply_type" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_no" text NOT NULL,
	"doc_date" date NOT NULL,
	"from_gstin" text NOT NULL,
	"from_pincode" text,
	"from_state_code" char(2),
	"to_gstin" text NOT NULL,
	"to_pincode" text,
	"to_state_code" char(2),
	"total_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"distance_km" integer NOT NULL,
	"transport_mode" text DEFAULT 'road' NOT NULL,
	"vehicle_type" char(1) DEFAULT 'R' NOT NULL,
	"vehicle_no" text,
	"transporter_id" text,
	"transporter_name" text,
	"trans_doc_no" text,
	"trans_doc_date" date,
	"vehicle_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extensions" smallint DEFAULT 0 NOT NULL,
	"consolidated_no" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_api_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"document_id" uuid,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text,
	"error_message" text,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_challan_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"challan_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"hsn_code" text,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"goods_type" text DEFAULT 'inputs' NOT NULL,
	"batch_no" text,
	"cost_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"consumed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"loss_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_challans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_worker_id" uuid NOT NULL,
	"job_worker_gstin" char(15),
	"job_worker_state_code" char(2),
	"warehouse_id" uuid NOT NULL,
	"job_work_warehouse_id" uuid NOT NULL,
	"process" text NOT NULL,
	"expected_return_date" date,
	"transporter" text,
	"vehicle_no" text,
	"total_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"eway_bill_no" text,
	"notes" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_work_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" text NOT NULL,
	"challan_line_id" uuid,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"consumed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"loss_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"batch_no" text,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"challan_id" uuid NOT NULL,
	"job_worker_id" uuid NOT NULL,
	"jw_challan_no" text,
	"jw_challan_date" date,
	"warehouse_id" uuid NOT NULL,
	"nature_of_job" text,
	"job_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "gst_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "foreign_rate" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "currency" char(3) DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "capture" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "foreign_rate" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "currency" char(3) DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "irn" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "ack_no" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "ack_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "signed_qr" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "irn_status" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "irn_error" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "irn_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "irn_status" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "irn_error" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "irn_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bill_of_entry_lines" ADD CONSTRAINT "bill_of_entry_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_of_entry_lines" ADD CONSTRAINT "bill_of_entry_lines_boe_id_bills_of_entry_id_fk" FOREIGN KEY ("boe_id") REFERENCES "public"."bills_of_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_of_entry_lines" ADD CONSTRAINT "bill_of_entry_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_of_entry_lines" ADD CONSTRAINT "bill_of_entry_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_api_logs" ADD CONSTRAINT "gst_api_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_api_logs" ADD CONSTRAINT "gst_api_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_api_logs" ADD CONSTRAINT "gst_api_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_challan_id_job_work_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."job_work_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_lines" ADD CONSTRAINT "job_work_challan_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challans" ADD CONSTRAINT "job_work_challans_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challans" ADD CONSTRAINT "job_work_challans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challans" ADD CONSTRAINT "job_work_challans_job_worker_id_parties_id_fk" FOREIGN KEY ("job_worker_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challans" ADD CONSTRAINT "job_work_challans_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challans" ADD CONSTRAINT "job_work_challans_job_work_warehouse_id_warehouses_id_fk" FOREIGN KEY ("job_work_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_receipt_id_job_work_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."job_work_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_challan_line_id_job_work_challan_lines_id_fk" FOREIGN KEY ("challan_line_id") REFERENCES "public"."job_work_challan_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_lines" ADD CONSTRAINT "job_work_receipt_lines_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_challan_id_job_work_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."job_work_challans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_job_worker_id_parties_id_fk" FOREIGN KEY ("job_worker_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boe_lines_b_idx" ON "bill_of_entry_lines" USING btree ("boe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boe_lines_no_uq" ON "bill_of_entry_lines" USING btree ("boe_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "boe_no_uq" ON "bills_of_entry" USING btree ("tenant_id","port_code","boe_no");--> statement-breakpoint
CREATE INDEX "boe_vendor_idx" ON "bills_of_entry" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eway_bills_no_uq" ON "eway_bills" USING btree ("tenant_id","ewb_no");--> statement-breakpoint
CREATE INDEX "eway_bills_doc_idx" ON "eway_bills" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "eway_bills_date_idx" ON "eway_bills" USING btree ("tenant_id","ewb_date");--> statement-breakpoint
CREATE INDEX "gst_api_logs_doc_idx" ON "gst_api_logs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "gst_api_logs_tenant_idx" ON "gst_api_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "jwc_lines_c_idx" ON "job_work_challan_lines" USING btree ("challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jwc_lines_no_uq" ON "job_work_challan_lines" USING btree ("challan_id","line_no");--> statement-breakpoint
CREATE INDEX "jwc_worker_idx" ON "job_work_challans" USING btree ("tenant_id","job_worker_id");--> statement-breakpoint
CREATE INDEX "jwr_lines_r_idx" ON "job_work_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jwr_lines_no_uq" ON "job_work_receipt_lines" USING btree ("receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "jwr_challan_idx" ON "job_work_receipts" USING btree ("challan_id");