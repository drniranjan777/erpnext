CREATE TABLE "tms_freight_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"transporter_id" uuid NOT NULL,
	"bill_no" text NOT NULL,
	"bill_date" text NOT NULL,
	"claimed_amount" numeric(12, 2) NOT NULL,
	"computed_amount" numeric(12, 2) NOT NULL,
	"difference" numeric(12, 2) NOT NULL,
	"lines" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_positions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"speed_kmh" numeric(6, 1),
	"source" text DEFAULT 'driver' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_rate_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"transporter_id" uuid NOT NULL,
	"valid_from" text NOT NULL,
	"valid_to" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"from_city" "citext",
	"from_state" text,
	"to_city" "citext",
	"to_state" text,
	"vehicle_type" text,
	"basis" text NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"min_charge" numeric(12, 2),
	"per_stop" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "tms_stops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"delivery_id" uuid,
	"party_id" uuid,
	"city" text,
	"state_code" text,
	"address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"arrived_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"received_by" text,
	"signature" text,
	"photo" text,
	"note" text,
	"latitude" double precision,
	"longitude" double precision
);
--> statement-breakpoint
CREATE TABLE "tms_transporters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"transporter_gst_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_trips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"trip_date" text NOT NULL,
	"warehouse_id" uuid,
	"transporter_id" uuid,
	"vehicle_id" uuid,
	"vehicle_no" text NOT NULL,
	"vehicle_type" text,
	"driver_name" text,
	"driver_phone" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_km" integer,
	"odometer_start" integer,
	"odometer_end" integer,
	"weight_kg" numeric(12, 3),
	"rate_id" uuid,
	"freight_amount" numeric(12, 2),
	"freight_basis" text,
	"expenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"driver_token_hash" text,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"freight_bill_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reg_no" "citext" NOT NULL,
	"ownership" text DEFAULT 'hired' NOT NULL,
	"vehicle_type" text NOT NULL,
	"capacity_kg" numeric(10, 1),
	"capacity_m3" numeric(8, 2),
	"transporter_id" uuid,
	"driver_name" text,
	"driver_phone" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tms_freight_bills" ADD CONSTRAINT "tms_freight_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_freight_bills" ADD CONSTRAINT "tms_freight_bills_transporter_id_tms_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."tms_transporters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_freight_bills" ADD CONSTRAINT "tms_freight_bills_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_freight_bills" ADD CONSTRAINT "tms_freight_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_positions" ADD CONSTRAINT "tms_positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_positions" ADD CONSTRAINT "tms_positions_trip_id_tms_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."tms_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_rate_contracts" ADD CONSTRAINT "tms_rate_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_rate_contracts" ADD CONSTRAINT "tms_rate_contracts_transporter_id_tms_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."tms_transporters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_rates" ADD CONSTRAINT "tms_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_rates" ADD CONSTRAINT "tms_rates_contract_id_tms_rate_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."tms_rate_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_stops" ADD CONSTRAINT "tms_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_stops" ADD CONSTRAINT "tms_stops_trip_id_tms_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."tms_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_stops" ADD CONSTRAINT "tms_stops_delivery_id_documents_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_stops" ADD CONSTRAINT "tms_stops_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_transporters" ADD CONSTRAINT "tms_transporters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_transporters" ADD CONSTRAINT "tms_transporters_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_transporter_id_tms_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."tms_transporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_vehicle_id_tms_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."tms_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_rate_id_tms_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."tms_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_trips" ADD CONSTRAINT "tms_trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_vehicles" ADD CONSTRAINT "tms_vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_vehicles" ADD CONSTRAINT "tms_vehicles_transporter_id_tms_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."tms_transporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tms_freight_bills_number_uq" ON "tms_freight_bills" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tms_freight_bills_bill_uq" ON "tms_freight_bills" USING btree ("transporter_id","bill_no");--> statement-breakpoint
CREATE INDEX "tms_positions_trip_idx" ON "tms_positions" USING btree ("trip_id","at");--> statement-breakpoint
CREATE INDEX "tms_rates_contract_idx" ON "tms_rates" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "tms_stops_trip_idx" ON "tms_stops" USING btree ("trip_id","seq");--> statement-breakpoint
CREATE INDEX "tms_stops_delivery_idx" ON "tms_stops" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tms_transporters_party_uq" ON "tms_transporters" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tms_trips_number_uq" ON "tms_trips" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tms_trips_token_uq" ON "tms_trips" USING btree ("driver_token_hash");--> statement-breakpoint
CREATE INDEX "tms_trips_date_idx" ON "tms_trips" USING btree ("tenant_id","trip_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tms_vehicles_reg_uq" ON "tms_vehicles" USING btree ("tenant_id","reg_no");