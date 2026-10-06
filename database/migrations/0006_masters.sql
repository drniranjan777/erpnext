CREATE TYPE "public"."address_type" AS ENUM('billing', 'shipping', 'both');--> statement-breakpoint
CREATE TYPE "public"."gst_registration_type" AS ENUM('regular', 'composition', 'unregistered', 'consumer', 'overseas', 'sez');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('raw_material', 'packing_material', 'semi_finished', 'finished_good', 'trading', 'consumable', 'spare', 'service', 'asset', 'scrap', 'by_product');--> statement-breakpoint
CREATE TYPE "public"."msme_category" AS ENUM('micro', 'small', 'medium');--> statement-breakpoint
CREATE TYPE "public"."price_list_type" AS ENUM('selling', 'buying');--> statement-breakpoint
CREATE TYPE "public"."valuation_method" AS ENUM('weighted_average', 'fifo');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('store', 'production', 'finished_goods', 'quarantine', 'rejected', 'scrap', 'transit', 'job_work');--> statement-breakpoint
CREATE TABLE "item_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"uom_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_uom_conversions" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"factor" numeric(18, 6) NOT NULL,
	CONSTRAINT "item_uom_conversions_item_id_uom_id_pk" PRIMARY KEY("item_id","uom_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "item_type" NOT NULL,
	"group_id" uuid,
	"base_uom_id" uuid NOT NULL,
	"purchase_uom_id" uuid,
	"sales_uom_id" uuid,
	"hsn_code" text,
	"gst_rate" numeric(5, 2),
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_nil_rated_or_exempt" boolean DEFAULT false NOT NULL,
	"is_stock_item" boolean DEFAULT true NOT NULL,
	"track_batch" boolean DEFAULT false NOT NULL,
	"track_serial" boolean DEFAULT false NOT NULL,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"min_remaining_shelf_life_days" integer,
	"valuation_method" "valuation_method" DEFAULT 'weighted_average' NOT NULL,
	"reorder_level" numeric(18, 4),
	"reorder_qty" numeric(18, 4),
	"safety_stock" numeric(18, 4),
	"min_order_qty" numeric(18, 4),
	"lead_time_days" integer,
	"standard_cost" numeric(18, 4),
	"last_purchase_rate" numeric(18, 4),
	"selling_rate" numeric(18, 4),
	"mrp" numeric(18, 2),
	"brand" text,
	"net_weight_kg" numeric(18, 4),
	"gross_weight_kg" numeric(18, 4),
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"abc_class" char(1),
	"is_active" boolean DEFAULT true NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_vendor" boolean DEFAULT false NOT NULL,
	"gst_registration_type" "gst_registration_type" DEFAULT 'regular' NOT NULL,
	"gstin" char(15),
	"pan" char(10),
	"state_code" char(2),
	"msme_udyam_no" text,
	"msme_category" "msme_category",
	"email" "citext",
	"phone" text,
	"website" text,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"credit_limit" numeric(18, 2),
	"credit_days" integer,
	"payment_terms" text,
	"tds_section" text,
	"tcs_applicable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "party_addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"type" "address_type" DEFAULT 'both' NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"district" text,
	"state_code" char(2) NOT NULL,
	"pincode" char(6),
	"country" char(2) DEFAULT 'IN' NOT NULL,
	"gstin" char(15),
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"account_name" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"account_last4" char(4) NOT NULL,
	"ifsc" char(11) NOT NULL,
	"bank_name" text,
	"branch_name" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"designation" text,
	"email" "citext",
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"min_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rate" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "price_list_type" NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_counters" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_counters_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "uoms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"decimals" smallint DEFAULT 3 NOT NULL,
	"uqc" text DEFAULT 'OTH' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"type" "warehouse_type" DEFAULT 'store' NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_nettable" boolean DEFAULT true NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_group_id_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."item_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_uom_id_uoms_id_fk" FOREIGN KEY ("purchase_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sales_uom_id_uoms_id_fk" FOREIGN KEY ("sales_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_bank_accounts" ADD CONSTRAINT "party_bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_bank_accounts" ADD CONSTRAINT "party_bank_accounts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_contacts" ADD CONSTRAINT "party_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_contacts" ADD CONSTRAINT "party_contacts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_barcodes_uq" ON "item_barcodes" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "item_barcodes_item_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_groups_code_uq" ON "item_groups" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "item_groups_parent_idx" ON "item_groups" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_uq" ON "items" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "items_type_idx" ON "items" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "items_group_idx" ON "items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "parties_code_uq" ON "parties" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_gstin_uq" ON "parties" USING btree ("tenant_id","gstin") WHERE "parties"."gstin" is not null and "parties"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "parties_roles_idx" ON "parties" USING btree ("tenant_id","is_customer","is_vendor");--> statement-breakpoint
CREATE INDEX "parties_name_trgm_idx" ON "parties" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "party_addresses_party_idx" ON "party_addresses" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_bank_party_idx" ON "party_bank_accounts" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_contacts_party_idx" ON "party_contacts" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_uq" ON "price_list_items" USING btree ("price_list_id","item_id","uom_id","min_qty");--> statement-breakpoint
CREATE INDEX "price_list_items_item_idx" ON "price_list_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_name_uq" ON "price_lists" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uoms_code_uq" ON "uoms" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_code_uq" ON "warehouses" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "warehouses_company_idx" ON "warehouses" USING btree ("company_id");