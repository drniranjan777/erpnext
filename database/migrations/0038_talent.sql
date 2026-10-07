CREATE TABLE "hr_appraisals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"self_score" numeric(4, 2),
	"manager_score" numeric(4, 2),
	"final_rating" smallint,
	"increment_pct" numeric(5, 2),
	"new_ctc" numeric(14, 2),
	"effective_from" date,
	"promote_to_designation_id" uuid,
	"remarks" text,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hr_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requisition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" "citext",
	"mobile" text,
	"source" text,
	"current_ctc" numeric(14, 2),
	"expected_ctc" numeric(14, 2),
	"notice_days" smallint,
	"stage" text DEFAULT 'applied' NOT NULL,
	"resume_id" uuid,
	"notes" text,
	"employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_checklists" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"assessed_on" date NOT NULL,
	"valid_until" date,
	"assessed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hr_goals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kra" text,
	"title" text NOT NULL,
	"target" text,
	"weight" numeric(5, 2) NOT NULL,
	"self_rating" smallint,
	"self_comment" text,
	"manager_rating" smallint,
	"manager_comment" text
);
--> statement-breakpoint
CREATE TABLE "hr_interviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"round" smallint DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"interviewer_id" uuid,
	"mode" text DEFAULT 'in_person' NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"score" smallint,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"designation_id" uuid,
	"grade_id" uuid,
	"ctc_annual" numeric(14, 2) NOT NULL,
	"salary_template_id" uuid,
	"joining_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"letter_body" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"location_id" uuid,
	"openings" smallint DEFAULT 1 NOT NULL,
	"reason" text DEFAULT 'new' NOT NULL,
	"replacement_for_id" uuid,
	"max_ctc" numeric(14, 2),
	"needed_by" date,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" text DEFAULT 'goal_setting' NOT NULL,
	"increment_guide" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_separations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"notice_date" date NOT NULL,
	"last_working_day" date NOT NULL,
	"reason" text NOT NULL,
	"notice_shortfall_days" smallint DEFAULT 0 NOT NULL,
	"waive_shortfall" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"settlement" jsonb,
	"journal_id" uuid,
	"requested_by" uuid,
	"accepted_by" uuid,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"applies_to" text,
	"validity_months" smallint
);
--> statement-breakpoint
CREATE TABLE "hr_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"separation_id" uuid,
	"title" text NOT NULL,
	"owner" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"remarks" text,
	"recovery" numeric(14, 2),
	"done_by" uuid,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hr_training_attendees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attended" boolean,
	"passed" boolean,
	"score" smallint
);
--> statement-breakpoint
CREATE TABLE "hr_trainings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"skill_id" uuid,
	"skill_level" smallint,
	"trainer" text,
	"starts_at" timestamp with time zone NOT NULL,
	"hours" numeric(5, 1) DEFAULT '1' NOT NULL,
	"venue" text,
	"capacity" smallint,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_appraisals" ADD CONSTRAINT "hr_appraisals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_appraisals" ADD CONSTRAINT "hr_appraisals_cycle_id_hr_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."hr_review_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_appraisals" ADD CONSTRAINT "hr_appraisals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_appraisals" ADD CONSTRAINT "hr_appraisals_promote_to_designation_id_hr_designations_id_fk" FOREIGN KEY ("promote_to_designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_requisition_id_hr_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."hr_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_resume_id_attachments_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_skills" ADD CONSTRAINT "hr_employee_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_skills" ADD CONSTRAINT "hr_employee_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_skills" ADD CONSTRAINT "hr_employee_skills_skill_id_hr_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."hr_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_skills" ADD CONSTRAINT "hr_employee_skills_assessed_by_users_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_cycle_id_hr_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."hr_review_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_candidate_id_hr_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hr_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_interviewer_id_employees_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_candidate_id_hr_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hr_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_designation_id_hr_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_grade_id_hr_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."hr_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_designation_id_hr_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_replacement_for_id_employees_id_fk" FOREIGN KEY ("replacement_for_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requisitions" ADD CONSTRAINT "hr_requisitions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_review_cycles" ADD CONSTRAINT "hr_review_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_separations" ADD CONSTRAINT "hr_separations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_separations" ADD CONSTRAINT "hr_separations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_separations" ADD CONSTRAINT "hr_separations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_separations" ADD CONSTRAINT "hr_separations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_skills" ADD CONSTRAINT "hr_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_tasks" ADD CONSTRAINT "hr_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_tasks" ADD CONSTRAINT "hr_tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_tasks" ADD CONSTRAINT "hr_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_attendees" ADD CONSTRAINT "hr_training_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_attendees" ADD CONSTRAINT "hr_training_attendees_training_id_hr_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."hr_trainings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_attendees" ADD CONSTRAINT "hr_training_attendees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trainings" ADD CONSTRAINT "hr_trainings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trainings" ADD CONSTRAINT "hr_trainings_skill_id_hr_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."hr_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_appraisals_uq" ON "hr_appraisals" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_candidates_req_idx" ON "hr_candidates" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "hr_checklists_kind_idx" ON "hr_checklists" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employee_skills_uq" ON "hr_employee_skills" USING btree ("employee_id","skill_id");--> statement-breakpoint
CREATE INDEX "hr_goals_cycle_emp_idx" ON "hr_goals" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_interviews_candidate_idx" ON "hr_interviews" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hr_offers_candidate_idx" ON "hr_offers" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_requisitions_number_uq" ON "hr_requisitions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "hr_separations_emp_idx" ON "hr_separations" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_skills_code_uq" ON "hr_skills" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "hr_tasks_emp_idx" ON "hr_tasks" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_training_attendees_uq" ON "hr_training_attendees" USING btree ("training_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_trainings_starts_idx" ON "hr_trainings" USING btree ("tenant_id","starts_at");