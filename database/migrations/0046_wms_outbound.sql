CREATE TABLE "wms_appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"door_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"party_id" uuid,
	"document_id" uuid,
	"reference" text,
	"vehicle_no" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_dock_doors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"direction" text DEFAULT 'both' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_packages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sscc" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"wave_id" uuid,
	"delivery_id" uuid,
	"kind" text DEFAULT 'carton' NOT NULL,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross_weight_kg" numeric(12, 3),
	"status" text DEFAULT 'open' NOT NULL,
	"vehicle_no" text,
	"loaded_at" timestamp with time zone,
	"loaded_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wms_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gs1_prefix" text,
	"sscc_extension" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wms_waves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"mode" text DEFAULT 'order' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"order_ids" uuid[] NOT NULL,
	"shortages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD COLUMN "wave_id" uuid;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD COLUMN "path_seq" integer;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_door_id_wms_dock_doors_id_fk" FOREIGN KEY ("door_id") REFERENCES "public"."wms_dock_doors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_appointments" ADD CONSTRAINT "wms_appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dock_doors" ADD CONSTRAINT "wms_dock_doors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_dock_doors" ADD CONSTRAINT "wms_dock_doors_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_order_id_documents_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_wave_id_wms_waves_id_fk" FOREIGN KEY ("wave_id") REFERENCES "public"."wms_waves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_delivery_id_documents_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_loaded_by_users_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_packages" ADD CONSTRAINT "wms_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_settings" ADD CONSTRAINT "wms_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_waves" ADD CONSTRAINT "wms_waves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_waves" ADD CONSTRAINT "wms_waves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wms_waves" ADD CONSTRAINT "wms_waves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wms_appointments_number_uq" ON "wms_appointments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "wms_appointments_door_idx" ON "wms_appointments" USING btree ("door_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_dock_doors_code_uq" ON "wms_dock_doors" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_packages_sscc_uq" ON "wms_packages" USING btree ("tenant_id","sscc");--> statement-breakpoint
CREATE INDEX "wms_packages_order_idx" ON "wms_packages" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_settings_tenant_uq" ON "wms_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wms_waves_number_uq" ON "wms_waves" USING btree ("tenant_id","number");--> statement-breakpoint
ALTER TABLE "wms_tasks" ADD CONSTRAINT "wms_tasks_order_id_documents_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;