CREATE TABLE "cm_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"machine_id" uuid,
	"kind" text NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"score" double precision NOT NULL,
	"baseline_mean" double precision NOT NULL,
	"baseline_std" double precision NOT NULL,
	"cleared_at" timestamp with time zone,
	"maintenance_order_id" uuid,
	"feedback" text,
	"feedback_note" text,
	"feedback_by" uuid,
	"feedback_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cm_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_samples" integer DEFAULT 200 NOT NULL,
	"z_threshold" double precision DEFAULT 4 NOT NULL,
	"consecutive" smallint DEFAULT 3 NOT NULL,
	"drift_threshold" double precision DEFAULT 2.5 NOT NULL,
	"create_maintenance" boolean DEFAULT true NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"mean" double precision DEFAULT 0 NOT NULL,
	"variance" double precision DEFAULT 0 NOT NULL,
	"recent" double precision,
	"streak" smallint DEFAULT 0 NOT NULL,
	"last_score" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_minutes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"machine_id" uuid,
	"minute" timestamp with time zone NOT NULL,
	"kwh" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_demand_kw" double precision,
	"demand_interval_minutes" smallint DEFAULT 30 NOT NULL,
	"alert_pct" smallint DEFAULT 90 NOT NULL,
	"grid_factor" double precision DEFAULT 0.716 NOT NULL,
	"tariff_per_kwh" double precision DEFAULT 8 NOT NULL,
	"main_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_alert_interval" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cm_anomalies" ADD CONSTRAINT "cm_anomalies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_anomalies" ADD CONSTRAINT "cm_anomalies_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_anomalies" ADD CONSTRAINT "cm_anomalies_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_anomalies" ADD CONSTRAINT "cm_anomalies_feedback_by_users_id_fk" FOREIGN KEY ("feedback_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_models" ADD CONSTRAINT "cm_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_models" ADD CONSTRAINT "cm_models_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_minutes" ADD CONSTRAINT "energy_minutes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_minutes" ADD CONSTRAINT "energy_minutes_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_minutes" ADD CONSTRAINT "energy_minutes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_settings" ADD CONSTRAINT "energy_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_anomalies_idx" ON "cm_anomalies" USING btree ("tenant_id","raised_at");--> statement-breakpoint
CREATE INDEX "cm_anomalies_open_idx" ON "cm_anomalies" USING btree ("tenant_id","signal_id","cleared_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cm_models_signal_uq" ON "cm_models" USING btree ("tenant_id","signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "energy_minutes_uq" ON "energy_minutes" USING btree ("tenant_id","signal_id","minute");--> statement-breakpoint
CREATE INDEX "energy_minutes_machine_idx" ON "energy_minutes" USING btree ("tenant_id","machine_id","minute");--> statement-breakpoint
CREATE UNIQUE INDEX "energy_settings_uq" ON "energy_settings" USING btree ("tenant_id");