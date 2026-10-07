CREATE TABLE "ai_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"cases" integer NOT NULL,
	"passed" integer NOT NULL,
	"score_pct" numeric(5, 1) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"note" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text,
	"user_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_inr" numeric(12, 4) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"reason" text,
	"pii_masked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "features" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "external_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "external_consent_by" uuid;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "mask_pii" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "monthly_budget_inr" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_changes" ADD CONSTRAINT "ai_model_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_changes" ADD CONSTRAINT "ai_model_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_eval_runs_idx" ON "ai_eval_runs" USING btree ("tenant_id","suite","created_at");--> statement-breakpoint
CREATE INDEX "ai_model_changes_idx" ON "ai_model_changes" USING btree ("tenant_id","feature","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_idx" ON "ai_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_external_consent_by_users_id_fk" FOREIGN KEY ("external_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;