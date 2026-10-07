CREATE TABLE "dms_beats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"distributor_id" uuid,
	"salesperson_id" uuid,
	"weekday" smallint,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"distributor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scheme_id" uuid,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"claimed_amount" numeric(16, 2) NOT NULL,
	"computed_amount" numeric(16, 2),
	"approved_amount" numeric(16, 2),
	"status" text DEFAULT 'submitted' NOT NULL,
	"notes" text,
	"decision_note" text,
	"journal_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_distributors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"territory_id" uuid,
	"salesperson_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_loyalty" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"retailer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"points" integer NOT NULL,
	"kind" text NOT NULL,
	"ref_key" text,
	"remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_retailers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"owner_name" text,
	"phone" text,
	"distributor_id" uuid NOT NULL,
	"beat_id" uuid,
	"address" text,
	"city" text,
	"state_code" text,
	"gstin" text,
	"outlet_class" text DEFAULT 'C' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_schemes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"level" text DEFAULT 'secondary' NOT NULL,
	"item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"slabs" jsonb NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_secondary_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"free_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_secondary_sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"distributor_id" uuid NOT NULL,
	"retailer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"visit_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"gross" numeric(16, 2) NOT NULL,
	"discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"net" numeric(16, 2) NOT NULL,
	"schemes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"points_per_hundred" numeric(6, 2) DEFAULT '1' NOT NULL,
	"visit_radius_metres" integer DEFAULT 200 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"distributor_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"kind" text NOT NULL,
	"remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_visits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"retailer_id" uuid NOT NULL,
	"beat_id" uuid,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"distance_metres" integer,
	"photo_id" uuid,
	"outcome" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "dms_beats" ADD CONSTRAINT "dms_beats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_beats" ADD CONSTRAINT "dms_beats_distributor_id_dms_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dms_distributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_beats" ADD CONSTRAINT "dms_beats_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_claims" ADD CONSTRAINT "dms_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_claims" ADD CONSTRAINT "dms_claims_distributor_id_dms_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dms_distributors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_claims" ADD CONSTRAINT "dms_claims_scheme_id_dms_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."dms_schemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_claims" ADD CONSTRAINT "dms_claims_journal_id_documents_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_claims" ADD CONSTRAINT "dms_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_distributors" ADD CONSTRAINT "dms_distributors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_distributors" ADD CONSTRAINT "dms_distributors_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_distributors" ADD CONSTRAINT "dms_distributors_territory_id_crm_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."crm_territories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_distributors" ADD CONSTRAINT "dms_distributors_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_loyalty" ADD CONSTRAINT "dms_loyalty_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_loyalty" ADD CONSTRAINT "dms_loyalty_retailer_id_dms_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."dms_retailers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_loyalty" ADD CONSTRAINT "dms_loyalty_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_retailers" ADD CONSTRAINT "dms_retailers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_retailers" ADD CONSTRAINT "dms_retailers_distributor_id_dms_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dms_distributors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_retailers" ADD CONSTRAINT "dms_retailers_beat_id_dms_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."dms_beats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_schemes" ADD CONSTRAINT "dms_schemes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_lines" ADD CONSTRAINT "dms_secondary_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_lines" ADD CONSTRAINT "dms_secondary_lines_sale_id_dms_secondary_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."dms_secondary_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_lines" ADD CONSTRAINT "dms_secondary_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_sales" ADD CONSTRAINT "dms_secondary_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_sales" ADD CONSTRAINT "dms_secondary_sales_distributor_id_dms_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dms_distributors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_sales" ADD CONSTRAINT "dms_secondary_sales_retailer_id_dms_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."dms_retailers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_sales" ADD CONSTRAINT "dms_secondary_sales_visit_id_dms_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."dms_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_secondary_sales" ADD CONSTRAINT "dms_secondary_sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_settings" ADD CONSTRAINT "dms_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_stock_adjustments" ADD CONSTRAINT "dms_stock_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_stock_adjustments" ADD CONSTRAINT "dms_stock_adjustments_distributor_id_dms_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dms_distributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_stock_adjustments" ADD CONSTRAINT "dms_stock_adjustments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_stock_adjustments" ADD CONSTRAINT "dms_stock_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_visits" ADD CONSTRAINT "dms_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_visits" ADD CONSTRAINT "dms_visits_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_visits" ADD CONSTRAINT "dms_visits_retailer_id_dms_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."dms_retailers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_visits" ADD CONSTRAINT "dms_visits_beat_id_dms_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."dms_beats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_visits" ADD CONSTRAINT "dms_visits_photo_id_attachments_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dms_beats_code_uq" ON "dms_beats" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_claims_number_uq" ON "dms_claims" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "dms_claims_dist_idx" ON "dms_claims" USING btree ("distributor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_distributors_party_uq" ON "dms_distributors" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_loyalty_ref_uq" ON "dms_loyalty" USING btree ("tenant_id","ref_key");--> statement-breakpoint
CREATE INDEX "dms_loyalty_retailer_idx" ON "dms_loyalty" USING btree ("retailer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_retailers_code_uq" ON "dms_retailers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "dms_retailers_beat_idx" ON "dms_retailers" USING btree ("beat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_schemes_code_uq" ON "dms_schemes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "dms_secondary_lines_sale_idx" ON "dms_secondary_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_secondary_sales_number_uq" ON "dms_secondary_sales" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "dms_secondary_sales_dist_idx" ON "dms_secondary_sales" USING btree ("distributor_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_settings_tenant_uq" ON "dms_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "dms_stock_adjustments_idx" ON "dms_stock_adjustments" USING btree ("distributor_id","item_id");--> statement-breakpoint
CREATE INDEX "dms_visits_sp_idx" ON "dms_visits" USING btree ("tenant_id","salesperson_id","check_in_at");--> statement-breakpoint
CREATE INDEX "dms_visits_retailer_idx" ON "dms_visits" USING btree ("retailer_id");