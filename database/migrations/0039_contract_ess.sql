CREATE TABLE "hr_contract_attendance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"ot_hours" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_contract_wages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"month" text NOT NULL,
	"days_paid" numeric(5, 1) NOT NULL,
	"gross_paid" numeric(14, 2) NOT NULL,
	"pf_deducted" numeric(14, 2) DEFAULT '0' NOT NULL,
	"esi_deducted" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_on" date
);
--> statement-breakpoint
CREATE TABLE "hr_contract_workers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"date_of_birth" date,
	"father_name" text,
	"skill" text DEFAULT 'unskilled' NOT NULL,
	"daily_wage" numeric(14, 2) NOT NULL,
	"uan" text,
	"esic_number" text,
	"aadhaar_last4" text,
	"mobile" text,
	"location_id" uuid,
	"joined_on" date NOT NULL,
	"left_on" date
);
--> statement-breakpoint
CREATE TABLE "hr_contractors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"licence_no" text,
	"licence_valid_until" date,
	"max_workers" smallint,
	"work" text,
	"location_id" uuid,
	"pf_code" text,
	"esi_code" text,
	"contact_name" text,
	"mobile" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"spent_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"receipt_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_amount" numeric(14, 2),
	"pay_month" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_minimum_wages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state_code" text NOT NULL,
	"skill" text NOT NULL,
	"daily_rate" numeric(14, 2) NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_contract_attendance" ADD CONSTRAINT "hr_contract_attendance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_attendance" ADD CONSTRAINT "hr_contract_attendance_worker_id_hr_contract_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."hr_contract_workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_wages" ADD CONSTRAINT "hr_contract_wages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_wages" ADD CONSTRAINT "hr_contract_wages_worker_id_hr_contract_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."hr_contract_workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_workers" ADD CONSTRAINT "hr_contract_workers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_workers" ADD CONSTRAINT "hr_contract_workers_contractor_id_hr_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."hr_contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_workers" ADD CONSTRAINT "hr_contract_workers_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contractors" ADD CONSTRAINT "hr_contractors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contractors" ADD CONSTRAINT "hr_contractors_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_receipt_id_attachments_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_minimum_wages" ADD CONSTRAINT "hr_minimum_wages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contract_attendance_uq" ON "hr_contract_attendance" USING btree ("worker_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contract_wages_uq" ON "hr_contract_wages" USING btree ("worker_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contract_workers_code_uq" ON "hr_contract_workers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "hr_contract_workers_contractor_idx" ON "hr_contract_workers" USING btree ("contractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contractors_code_uq" ON "hr_contractors" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "hr_claims_emp_idx" ON "hr_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_claims_status_idx" ON "hr_claims" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_minimum_wages_uq" ON "hr_minimum_wages" USING btree ("tenant_id","state_code","skill","effective_from");