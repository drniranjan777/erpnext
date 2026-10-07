CREATE TABLE "blend_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blend_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"batch_no" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"new_batch_no" text NOT NULL,
	"expiry_date" date,
	"total_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "machine_cleanings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"kind" text DEFAULT 'minor' NOT NULL,
	"previous_item_id" uuid,
	"cleaned_by" text NOT NULL,
	"verified_by" text,
	"result" text,
	"notes" text,
	"recorded_by" uuid,
	"cleaned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "requires_cleaning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "clean_status" text DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "last_item_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD COLUMN "cost_share_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "blend_lines" ADD CONSTRAINT "blend_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blend_lines" ADD CONSTRAINT "blend_lines_blend_id_blends_id_fk" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blends" ADD CONSTRAINT "blends_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blends" ADD CONSTRAINT "blends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blends" ADD CONSTRAINT "blends_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blends" ADD CONSTRAINT "blends_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_cleanings" ADD CONSTRAINT "machine_cleanings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_cleanings" ADD CONSTRAINT "machine_cleanings_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_cleanings" ADD CONSTRAINT "machine_cleanings_previous_item_id_items_id_fk" FOREIGN KEY ("previous_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_cleanings" ADD CONSTRAINT "machine_cleanings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blend_lines_b_idx" ON "blend_lines" USING btree ("blend_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blend_lines_no_uq" ON "blend_lines" USING btree ("blend_id","line_no");--> statement-breakpoint
CREATE INDEX "machine_cleanings_m_idx" ON "machine_cleanings" USING btree ("machine_id","cleaned_at");--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_last_item_id_items_id_fk" FOREIGN KEY ("last_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;