CREATE TABLE "wms_3pl_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"pallet_days" numeric(14, 2) NOT NULL,
	"units_in" numeric(18, 4) NOT NULL,
	"units_out" numeric(18, 4) NOT NULL,
	"storage_amount" numeric(12, 2) NOT NULL,
	"handling_amount" numeric(12, 2) NOT NULL,
	"minimum_top_up" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_3pl_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"storage_per_pallet_day" numeric(10, 2) NOT NULL,
	"inbound_per_unit" numeric(10, 4) DEFAULT '0' NOT NULL,
	"outbound_per_unit" numeric(10, 4) DEFAULT '0' NOT NULL,
	"minimum_monthly" numeric(12, 2),
	"default_units_per_pallet" numeric(12, 3) DEFAULT '1' NOT NULL,
	"service_item_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_client_refs" (
	"tenant_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wms_client_refs_tenant_id_ref_pk" PRIMARY KEY("tenant_id","ref")
);
--> statement-breakpoint
CREATE TABLE "wms_rfid_reads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gate" text NOT NULL,
	"epc" text NOT NULL,
	"gtin" text,
	"item_id" uuid,
	"serial_no" text,
	"delivery_id" uuid,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_rfid_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"epc" text NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD COLUMN "owner_party_id" uuid;--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD COLUMN "units_per_pallet" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "wms_3pl_bills" ADD CONSTRAINT "wms_3pl_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_bills" ADD CONSTRAINT "wms_3pl_bills_client_id_wms_3pl_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."wms_3pl_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_bills" ADD CONSTRAINT "wms_3pl_bills_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_bills" ADD CONSTRAINT "wms_3pl_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_clients" ADD CONSTRAINT "wms_3pl_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_clients" ADD CONSTRAINT "wms_3pl_clients_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_3pl_clients" ADD CONSTRAINT "wms_3pl_clients_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_client_refs" ADD CONSTRAINT "wms_client_refs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_reads" ADD CONSTRAINT "wms_rfid_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_reads" ADD CONSTRAINT "wms_rfid_reads_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_reads" ADD CONSTRAINT "wms_rfid_reads_delivery_id_documents_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_tags" ADD CONSTRAINT "wms_rfid_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_tags" ADD CONSTRAINT "wms_rfid_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_rfid_tags" ADD CONSTRAINT "wms_rfid_tags_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wms_3pl_bills_period_uq" ON "wms_3pl_bills" USING btree ("client_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_3pl_clients_uq" ON "wms_3pl_clients" USING btree ("party_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "wms_rfid_reads_gate_idx" ON "wms_rfid_reads" USING btree ("tenant_id","gate","read_at");--> statement-breakpoint
CREATE INDEX "wms_rfid_reads_delivery_idx" ON "wms_rfid_reads" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_rfid_tags_epc_uq" ON "wms_rfid_tags" USING btree ("tenant_id","epc");--> statement-breakpoint
ALTER TABLE "wms_item_profiles" ADD CONSTRAINT "wms_item_profiles_owner_party_id_parties_id_fk" FOREIGN KEY ("owner_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;