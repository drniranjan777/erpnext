CREATE TABLE "ai_action_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"agent_code" text NOT NULL,
	"action_type" text NOT NULL,
	"params" jsonb NOT NULL,
	"mode" text NOT NULL,
	"actor_user_id" uuid,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"schedule" text DEFAULT 'daily' NOT NULL,
	"run_hour" smallint DEFAULT 7 NOT NULL,
	"guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_code" text NOT NULL,
	"run_id" uuid,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"link" text,
	"dedupe_key" text NOT NULL,
	"action" jsonb,
	"confidence" numeric(4, 2),
	"permission" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"auto_executed" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_code" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"findings" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"executed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"killed" boolean DEFAULT false NOT NULL,
	"killed_by" uuid,
	"killed_at" timestamp with time zone,
	"kill_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_recommendation_id_ai_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."ai_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_killed_by_users_id_fk" FOREIGN KEY ("killed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_action_log_idx" ON "ai_action_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_code_uq" ON "ai_agents" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ai_recs_status_idx" ON "ai_recommendations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_recs_dedupe_idx" ON "ai_recommendations" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "ai_runs_agent_idx" ON "ai_runs" USING btree ("tenant_id","agent_code","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_tenant_uq" ON "ai_settings" USING btree ("tenant_id");