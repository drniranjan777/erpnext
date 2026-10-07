CREATE TABLE "mes_andon_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"raised_by" uuid,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_by" uuid,
	"acked_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "mes_counters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"last_value" double precision NOT NULL,
	"last_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mes_counts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"good" double precision DEFAULT 0 NOT NULL,
	"reject" double precision DEFAULT 0 NOT NULL,
	"ideal_seconds" double precision DEFAULT 0 NOT NULL,
	"job_card_id" uuid
);
--> statement-breakpoint
CREATE TABLE "mes_downtime_reasons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"loss" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mes_machine_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"ideal_cycle_seconds" double precision,
	"stop_after_seconds" integer DEFAULT 120 NOT NULL,
	"minor_stop_seconds" integer DEFAULT 300 NOT NULL,
	"target_oee_pct" smallint DEFAULT 65 NOT NULL,
	"last_part_at" timestamp with time zone,
	"last_signal_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mes_machine_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason_id" uuid,
	"note" text,
	"source" text DEFAULT 'auto' NOT NULL,
	"set_by" uuid
);
--> statement-breakpoint
CREATE TABLE "mes_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mes_andon_calls" ADD CONSTRAINT "mes_andon_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_andon_calls" ADD CONSTRAINT "mes_andon_calls_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_andon_calls" ADD CONSTRAINT "mes_andon_calls_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_andon_calls" ADD CONSTRAINT "mes_andon_calls_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_counters" ADD CONSTRAINT "mes_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_counters" ADD CONSTRAINT "mes_counters_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_counts" ADD CONSTRAINT "mes_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_counts" ADD CONSTRAINT "mes_counts_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_counts" ADD CONSTRAINT "mes_counts_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_downtime_reasons" ADD CONSTRAINT "mes_downtime_reasons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_settings" ADD CONSTRAINT "mes_machine_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_settings" ADD CONSTRAINT "mes_machine_settings_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_states" ADD CONSTRAINT "mes_machine_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_states" ADD CONSTRAINT "mes_machine_states_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_states" ADD CONSTRAINT "mes_machine_states_reason_id_mes_downtime_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."mes_downtime_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_machine_states" ADD CONSTRAINT "mes_machine_states_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mes_shifts" ADD CONSTRAINT "mes_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mes_andon_open_idx" ON "mes_andon_calls" USING btree ("tenant_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_counters_uq" ON "mes_counters" USING btree ("tenant_id","signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_counts_uq" ON "mes_counts" USING btree ("tenant_id","machine_id","minute");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_reasons_code_uq" ON "mes_downtime_reasons" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_machine_settings_uq" ON "mes_machine_settings" USING btree ("tenant_id","machine_id");--> statement-breakpoint
CREATE INDEX "mes_states_machine_idx" ON "mes_machine_states" USING btree ("tenant_id","machine_id","started_at");--> statement-breakpoint
CREATE INDEX "mes_states_open_idx" ON "mes_machine_states" USING btree ("tenant_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mes_shifts_code_uq" ON "mes_shifts" USING btree ("tenant_id","code");