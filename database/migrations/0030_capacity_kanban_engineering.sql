CREATE TABLE "kanban_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loop_id" uuid NOT NULL,
	"card_no" smallint NOT NULL,
	"status" text DEFAULT 'full' NOT NULL,
	"signalled_at" timestamp with time zone,
	"doc_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_loops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"source_warehouse_id" uuid,
	"vendor_id" uuid,
	"container_qty" numeric(18, 4) NOT NULL,
	"lead_time_days" smallint DEFAULT 1 NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_transitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_center_id" uuid NOT NULL,
	"from_item_id" uuid NOT NULL,
	"to_item_id" uuid NOT NULL,
	"minutes" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"drawing_no" "citext" NOT NULL,
	"revision" text NOT NULL,
	"title" text NOT NULL,
	"item_id" uuid,
	"sheet_size" text,
	"previous_id" uuid,
	"change_id" uuid,
	"released_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "engineering_change_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"from_doc_id" uuid,
	"to_doc_id" uuid,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "engineering_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"effective_date" date,
	"disposition" text DEFAULT 'use_as_is' NOT NULL,
	"stage" text DEFAULT 'request' NOT NULL,
	"implemented_at" timestamp with time zone,
	"implementation_notes" text,
	"impact_snapshot" jsonb
);
--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "days_per_week" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "shift_start" smallint DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "scheduled_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "scheduled_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "lane" smallint;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "setup_applied" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD COLUMN "schedule_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_loop_id_kanban_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."kanban_loops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_loops" ADD CONSTRAINT "kanban_loops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_loops" ADD CONSTRAINT "kanban_loops_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_loops" ADD CONSTRAINT "kanban_loops_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_loops" ADD CONSTRAINT "kanban_loops_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_loops" ADD CONSTRAINT "kanban_loops_vendor_id_parties_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_transitions" ADD CONSTRAINT "setup_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_transitions" ADD CONSTRAINT "setup_transitions_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_transitions" ADD CONSTRAINT "setup_transitions_from_item_id_items_id_fk" FOREIGN KEY ("from_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_transitions" ADD CONSTRAINT "setup_transitions_to_item_id_items_id_fk" FOREIGN KEY ("to_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_previous_id_drawings_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."drawings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_change_id_engineering_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."engineering_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_change_items" ADD CONSTRAINT "engineering_change_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_change_items" ADD CONSTRAINT "engineering_change_items_change_id_engineering_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."engineering_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_change_items" ADD CONSTRAINT "engineering_change_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_change_items" ADD CONSTRAINT "engineering_change_items_from_doc_id_documents_id_fk" FOREIGN KEY ("from_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_change_items" ADD CONSTRAINT "engineering_change_items_to_doc_id_documents_id_fk" FOREIGN KEY ("to_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD CONSTRAINT "engineering_changes_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_changes" ADD CONSTRAINT "engineering_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kanban_cards_no_uq" ON "kanban_cards" USING btree ("loop_id","card_no");--> statement-breakpoint
CREATE INDEX "kanban_loops_tenant_idx" ON "kanban_loops" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_transitions_uq" ON "setup_transitions" USING btree ("work_center_id","from_item_id","to_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drawings_no_rev_uq" ON "drawings" USING btree ("tenant_id","drawing_no","revision");--> statement-breakpoint
CREATE INDEX "drawings_item_idx" ON "drawings" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "eci_change_idx" ON "engineering_change_items" USING btree ("change_id");--> statement-breakpoint
CREATE INDEX "eci_item_idx" ON "engineering_change_items" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "wo_ops_sched_idx" ON "work_order_operations" USING btree ("tenant_id","work_center_id","scheduled_start");