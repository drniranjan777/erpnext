CREATE TABLE "iot_alarm_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"op" text NOT NULL,
	"threshold" double precision NOT NULL,
	"threshold2" double precision,
	"delay_seconds" integer DEFAULT 0 NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"create_maintenance" boolean DEFAULT false NOT NULL,
	"pending_since" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_alarms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"machine_id" uuid,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"peak_value" double precision NOT NULL,
	"cleared_at" timestamp with time zone,
	"acked_by" uuid,
	"acked_at" timestamp with time zone,
	"note" text,
	"maintenance_order_id" uuid,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "iot_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"readings" integer NOT NULL,
	"accepted" integer NOT NULL,
	"lag_seconds" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_gateways" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"token_hash" text,
	"token_hint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"agent_version" text,
	"buffered" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_readings" (
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "iot_readings_signal_id_ts_pk" PRIMARY KEY("signal_id","ts")
);
--> statement-breakpoint
CREATE TABLE "iot_signals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gateway_id" uuid,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"machine_id" uuid,
	"warehouse_id" uuid,
	"vehicle_no" text,
	"purpose" text DEFAULT 'other' NOT NULL,
	"unit" text,
	"scale" double precision DEFAULT 1 NOT NULL,
	"offset" double precision DEFAULT 0 NOT NULL,
	"deadband" double precision DEFAULT 0 NOT NULL,
	"source" jsonb DEFAULT '{"protocol":"push"}'::jsonb NOT NULL,
	"last_value" double precision,
	"last_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_rule_id_iot_alarm_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."iot_alarm_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_batches" ADD CONSTRAINT "iot_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_batches" ADD CONSTRAINT "iot_batches_gateway_id_iot_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_gateways" ADD CONSTRAINT "iot_gateways_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_gateways" ADD CONSTRAINT "iot_gateways_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_readings" ADD CONSTRAINT "iot_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_readings" ADD CONSTRAINT "iot_readings_signal_id_iot_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."iot_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_gateway_id_iot_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_signals" ADD CONSTRAINT "iot_signals_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iot_alarm_rules_signal_idx" ON "iot_alarm_rules" USING btree ("tenant_id","signal_id");--> statement-breakpoint
CREATE INDEX "iot_alarms_open_idx" ON "iot_alarms" USING btree ("tenant_id","cleared_at");--> statement-breakpoint
CREATE INDEX "iot_alarms_rule_idx" ON "iot_alarms" USING btree ("rule_id","cleared_at");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_batches_uq" ON "iot_batches" USING btree ("tenant_id","gateway_id","batch_id");--> statement-breakpoint
CREATE INDEX "iot_batches_received_idx" ON "iot_batches" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_gateways_code_uq" ON "iot_gateways" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "iot_gateways_token_idx" ON "iot_gateways" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "iot_readings_tenant_ts_idx" ON "iot_readings" USING btree ("tenant_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_signals_code_uq" ON "iot_signals" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "iot_signals_machine_idx" ON "iot_signals" USING btree ("tenant_id","machine_id");