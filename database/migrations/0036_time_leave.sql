CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"status" text NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"ot_minutes" integer DEFAULT 0 NOT NULL,
	"leave_type_id" uuid,
	"leave_days" numeric(3, 1) DEFAULT '0' NOT NULL,
	"payable_days" numeric(3, 1) DEFAULT '0' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_punches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"device_id" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"distance_metres" integer,
	"inside_fence" boolean,
	"selfie_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_regularisations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"in_at" timestamp with time zone,
	"out_at" timestamp with time zone,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_ids" uuid[] NOT NULL,
	"rotate_every_days" smallint DEFAULT 7 NOT NULL,
	"weekly_offs" smallint[] DEFAULT '{0}' NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" smallint DEFAULT 30 NOT NULL,
	"grace_minutes" smallint DEFAULT 10 NOT NULL,
	"half_day_minutes" smallint DEFAULT 240 NOT NULL,
	"full_day_minutes" smallint DEFAULT 450 NOT NULL,
	"ot_after_minutes" smallint,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"from_half" boolean DEFAULT false NOT NULL,
	"to_half" boolean DEFAULT false NOT NULL,
	"days" numeric(5, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"kind" text NOT NULL,
	"ref_key" text,
	"remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual" text DEFAULT 'monthly' NOT NULL,
	"annual_quota" numeric(5, 2) DEFAULT '0' NOT NULL,
	"days_worked_per_leave" smallint,
	"carry_forward_max" numeric(5, 2) DEFAULT '0' NOT NULL,
	"encashable" boolean DEFAULT false NOT NULL,
	"encash_max" numeric(5, 2),
	"allow_half_day" boolean DEFAULT true NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"count_holidays" boolean DEFAULT false NOT NULL,
	"is_comp_off" boolean DEFAULT false NOT NULL,
	"gender" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_shift_id_hr_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."hr_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_selfie_id_attachments_id_fk" FOREIGN KEY ("selfie_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_regularisations" ADD CONSTRAINT "attendance_regularisations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_regularisations" ADD CONSTRAINT "attendance_regularisations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_regularisations" ADD CONSTRAINT "attendance_regularisations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_regularisations" ADD CONSTRAINT "attendance_regularisations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_shift_assignments" ADD CONSTRAINT "hr_shift_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_shift_assignments" ADD CONSTRAINT "hr_shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_uq" ON "attendance_days" USING btree ("tenant_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_date_idx" ON "attendance_days" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_uq" ON "attendance_punches" USING btree ("tenant_id","employee_id","punched_at");--> statement-breakpoint
CREATE INDEX "attendance_regularisations_status_idx" ON "attendance_regularisations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "hr_holidays_date_idx" ON "hr_holidays" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "hr_shift_assignments_emp_idx" ON "hr_shift_assignments" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_shifts_code_uq" ON "hr_shifts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "leave_applications_emp_idx" ON "leave_applications" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE INDEX "leave_applications_status_idx" ON "leave_applications" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_ref_uq" ON "leave_ledger" USING btree ("tenant_id","ref_key");--> statement-breakpoint
CREATE INDEX "leave_ledger_emp_idx" ON "leave_ledger" USING btree ("employee_id","leave_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_uq" ON "leave_types" USING btree ("tenant_id","code");