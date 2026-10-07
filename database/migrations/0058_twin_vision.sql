CREATE TABLE "twin_layouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"width" smallint DEFAULT 60 NOT NULL,
	"height" smallint DEFAULT 30 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_nodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"machine_id" uuid,
	"work_center_id" uuid,
	"label" text,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision DEFAULT 4 NOT NULL,
	"h" double precision DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vision_deployments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"command_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vision_inspections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gateway_id" uuid,
	"model_id" uuid,
	"machine_id" uuid,
	"job_card_id" uuid,
	"ref" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"defect_class" text,
	"confidence" double precision NOT NULL,
	"image_url" text,
	"latency_ms" integer,
	"review" text,
	"actual_class" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vision_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_confidence" double precision DEFAULT 0.6 NOT NULL,
	"artifact_url" text,
	"validation" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"deployed_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_layouts" ADD CONSTRAINT "twin_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_layouts" ADD CONSTRAINT "twin_layouts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_nodes" ADD CONSTRAINT "twin_nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_nodes" ADD CONSTRAINT "twin_nodes_layout_id_twin_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."twin_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_nodes" ADD CONSTRAINT "twin_nodes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_nodes" ADD CONSTRAINT "twin_nodes_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_deployments" ADD CONSTRAINT "vision_deployments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_deployments" ADD CONSTRAINT "vision_deployments_model_id_vision_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vision_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_deployments" ADD CONSTRAINT "vision_deployments_gateway_id_iot_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_gateway_id_iot_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_model_id_vision_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vision_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_inspections" ADD CONSTRAINT "vision_inspections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_models" ADD CONSTRAINT "vision_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_models" ADD CONSTRAINT "vision_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twin_layouts_idx" ON "twin_layouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "twin_nodes_layout_idx" ON "twin_nodes" USING btree ("tenant_id","layout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vision_deployments_uq" ON "vision_deployments" USING btree ("tenant_id","model_id","gateway_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vision_inspections_ref_uq" ON "vision_inspections" USING btree ("tenant_id","gateway_id","ref");--> statement-breakpoint
CREATE INDEX "vision_inspections_idx" ON "vision_inspections" USING btree ("tenant_id","ts");--> statement-breakpoint
CREATE INDEX "vision_inspections_model_idx" ON "vision_inspections" USING btree ("tenant_id","model_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "vision_models_uq" ON "vision_models" USING btree ("tenant_id","name","version");