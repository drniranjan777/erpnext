CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"expiry_date" date,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"effective_date" date NOT NULL,
	"from" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remarks" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_family" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"date_of_birth" date,
	"is_dependent" boolean DEFAULT false NOT NULL,
	"nominee_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nominee_share_pct" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "employee_letters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"template_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"issued_on" date NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"full_name" text NOT NULL,
	"gender" text,
	"date_of_birth" date,
	"blood_group" text,
	"marital_status" text,
	"father_or_spouse_name" text,
	"personal_email" text,
	"mobile" text,
	"current_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permanent_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"emergency_contact" text,
	"emergency_phone" text,
	"date_of_joining" date NOT NULL,
	"probation_end" date,
	"confirmed_on" date,
	"employment_type" text DEFAULT 'probation' NOT NULL,
	"category" text DEFAULT 'staff' NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"grade_id" uuid,
	"location_id" uuid,
	"reports_to_id" uuid,
	"user_id" uuid,
	"work_email" text,
	"notice_days" smallint DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"exit_date" date,
	"exit_reason" text,
	"pan_enc" text,
	"pan_masked" text,
	"aadhaar_enc" text,
	"aadhaar_last4" char(4),
	"uan" text,
	"pf_number" text,
	"esic_number" text,
	"bank_name" text,
	"bank_account_enc" text,
	"bank_account_last4" text,
	"ifsc" char(11),
	"pf_applicable" boolean DEFAULT true NOT NULL,
	"esi_applicable" boolean DEFAULT true NOT NULL,
	"pt_applicable" boolean DEFAULT true NOT NULL,
	"lwf_applicable" boolean DEFAULT true NOT NULL,
	"tax_regime" text DEFAULT 'new' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"cost_centre" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_designations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"grade_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_grades" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"min_salary" numeric(18, 2),
	"max_salary" numeric(18, 2),
	"level" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"state_code" char(2) NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_factory" boolean DEFAULT true NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"radius_metres" smallint,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_events" ADD CONSTRAINT "employee_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_events" ADD CONSTRAINT "employee_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_events" ADD CONSTRAINT "employee_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_family" ADD CONSTRAINT "employee_family_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_family" ADD CONSTRAINT "employee_family_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_letters" ADD CONSTRAINT "employee_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_letters" ADD CONSTRAINT "employee_letters_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_letters" ADD CONSTRAINT "employee_letters_template_id_letter_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."letter_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_letters" ADD CONSTRAINT "employee_letters_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_hr_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_hr_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."hr_grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_reports_to_id_employees_id_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_parent_id_hr_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_grade_id_hr_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."hr_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_grades" ADD CONSTRAINT "hr_grades_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_locations" ADD CONSTRAINT "hr_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_documents_emp_idx" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_events_emp_idx" ON "employee_events" USING btree ("employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "employee_family_emp_idx" ON "employee_family" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_letters_emp_idx" ON "employee_letters" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_uq" ON "employees" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_uq" ON "employees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "employees_dept_idx" ON "employees" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("reports_to_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_code_uq" ON "hr_departments" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_designations_code_uq" ON "hr_designations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_grades_code_uq" ON "hr_grades" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_locations_code_uq" ON "hr_locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "letter_templates_code_uq" ON "letter_templates" USING btree ("tenant_id","code");