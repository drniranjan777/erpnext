CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"saved_report_id" uuid,
	"report_key" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency" text NOT NULL,
	"weekday" smallint,
	"month_day" smallint,
	"hour" smallint DEFAULT 8 NOT NULL,
	"recipients" text[] NOT NULL,
	"format" text DEFAULT 'xlsx' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_saved_report_id_saved_reports_id_fk" FOREIGN KEY ("saved_report_id") REFERENCES "public"."saved_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedules_owner_idx" ON "report_schedules" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "saved_reports_owner_idx" ON "saved_reports" USING btree ("tenant_id","owner_id");