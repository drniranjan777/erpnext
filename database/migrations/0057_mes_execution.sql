CREATE TABLE "iot_commands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"kind" text DEFAULT 'write' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mes_executions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_card_id" uuid NOT NULL,
	"machine_id" uuid,
	"operator_name" text,
	"instruction_id" uuid,
	"steps_acked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scans" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_off" text DEFAULT 'not_required' NOT NULL,
	"first_off_readings" jsonb,
	"first_off_note" text,
	"first_off_by" uuid,
	"first_off_at" timestamp with time zone,
	"recipe_id" uuid,
	"command_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mes_inline_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"readings" jsonb NOT NULL,
	"all_ok" boolean NOT NULL,
	"by" uuid
);
--> statement-breakpoint
CREATE TABLE "mes_instructions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"operation_seq" smallint NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"characteristics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_off_required" boolean DEFAULT false NOT NULL,
	"scan_materials" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mes_machine_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"operator_name" text NOT NULL,
	"user_id" uuid,
	"login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logout_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mes_recipes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"machine_id" uuid,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mes_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operator_name" text NOT NULL,
	"user_id" uuid,
	"work_center_id" uuid NOT NULL,
	"level" smallint DEFAULT 2 NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iot_commands" ADD CONSTRAINT "iot_commands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_commands" ADD CONSTRAINT "iot_commands_gateway_id_iot_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_instruction_id_mes_instructions_id_fk" FOREIGN KEY ("instruction_id") REFERENCES "public"."mes_instructions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_first_off_by_users_id_fk" FOREIGN KEY ("first_off_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_recipe_id_mes_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."mes_recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_command_id_iot_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."iot_commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_executions" ADD CONSTRAINT "mes_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_inline_checks" ADD CONSTRAINT "mes_inline_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_inline_checks" ADD CONSTRAINT "mes_inline_checks_execution_id_mes_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."mes_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_inline_checks" ADD CONSTRAINT "mes_inline_checks_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_instructions" ADD CONSTRAINT "mes_instructions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_instructions" ADD CONSTRAINT "mes_instructions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_instructions" ADD CONSTRAINT "mes_instructions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_instructions" ADD CONSTRAINT "mes_instructions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_sessions" ADD CONSTRAINT "mes_machine_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_sessions" ADD CONSTRAINT "mes_machine_sessions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_sessions" ADD CONSTRAINT "mes_machine_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_recipes" ADD CONSTRAINT "mes_recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_recipes" ADD CONSTRAINT "mes_recipes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_recipes" ADD CONSTRAINT "mes_recipes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_recipes" ADD CONSTRAINT "mes_recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_recipes" ADD CONSTRAINT "mes_recipes_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_skills" ADD CONSTRAINT "mes_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_skills" ADD CONSTRAINT "mes_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_skills" ADD CONSTRAINT "mes_skills_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iot_commands_gateway_idx" ON "iot_commands" USING btree ("tenant_id","gateway_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_executions_card_uq" ON "mes_executions" USING btree ("tenant_id","job_card_id");--> statement-breakpoint
CREATE INDEX "mes_inline_exec_idx" ON "mes_inline_checks" USING btree ("tenant_id","execution_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_instructions_uq" ON "mes_instructions" USING btree ("tenant_id","item_id","operation_seq","version");--> statement-breakpoint
CREATE INDEX "mes_sessions_machine_idx" ON "mes_machine_sessions" USING btree ("tenant_id","machine_id","logout_at");--> statement-breakpoint
CREATE INDEX "mes_recipes_item_idx" ON "mes_recipes" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "mes_skills_wc_idx" ON "mes_skills" USING btree ("tenant_id","work_center_id");