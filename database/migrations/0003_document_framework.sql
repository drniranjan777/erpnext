CREATE TYPE "public"."approval_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."series_reset" AS ENUM('yearly', 'monthly', 'never');--> statement-breakpoint
CREATE TYPE "public"."requisition_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TABLE "approval_rule_steps" (
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"step_no" smallint NOT NULL,
	"name" text NOT NULL,
	"approver_role_id" uuid,
	"approver_user_id" uuid,
	CONSTRAINT "approval_rule_steps_rule_id_step_no_pk" PRIMARY KEY("rule_id","step_no")
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid,
	"branch_id" uuid,
	"min_amount" numeric(18, 2),
	"max_amount" numeric(18, 2),
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_activity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"message" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"step_no" smallint NOT NULL,
	"name" text NOT NULL,
	"approver_role_id" uuid,
	"approver_user_id" uuid,
	"status" "approval_status" NOT NULL,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"tenant_id" uuid NOT NULL,
	"from_document_id" uuid NOT NULL,
	"to_document_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_links_from_document_id_to_document_id_link_type_pk" PRIMARY KEY("from_document_id","to_document_id","link_type")
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_document_id_revision_pk" PRIMARY KEY("document_id","revision")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"doc_type" text NOT NULL,
	"series_id" uuid,
	"number" text,
	"fiscal_year" text,
	"doc_date" date NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"title" text,
	"amount" numeric(18, 2),
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"current_step" smallint,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"doc_type" text NOT NULL,
	"name" text NOT NULL,
	"pattern" text NOT NULL,
	"padding" smallint DEFAULT 4 NOT NULL,
	"reset" "series_reset" DEFAULT 'yearly' NOT NULL,
	"start_at" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series_counters" (
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"next_value" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_series_counters_series_id_period_key_pk" PRIMARY KEY("series_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requisition_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_code" text,
	"description" text NOT NULL,
	"uom" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"estimated_rate" numeric(18, 4),
	"estimated_amount" numeric(18, 2),
	"required_by" date,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"required_by" date,
	"department" text,
	"purpose" text,
	"priority" "requisition_priority" DEFAULT 'normal' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "approval_rule_steps" ADD CONSTRAINT "approval_rule_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_steps" ADD CONSTRAINT "approval_rule_steps_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_steps" ADD CONSTRAINT "approval_rule_steps_approver_role_id_roles_id_fk" FOREIGN KEY ("approver_role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_steps" ADD CONSTRAINT "approval_rule_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_approver_role_id_roles_id_fk" FOREIGN KEY ("approver_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_document_id_documents_id_fk" FOREIGN KEY ("from_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_document_id_documents_id_fk" FOREIGN KEY ("to_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_series_id_number_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."number_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_series_id_number_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."number_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_id_documents_id_fk" FOREIGN KEY ("id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_rules_lookup_idx" ON "approval_rules" USING btree ("tenant_id","doc_type","is_active");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "document_activity_doc_idx" ON "document_activity" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_approvals_doc_idx" ON "document_approvals" USING btree ("document_id","round","step_no");--> statement-breakpoint
CREATE INDEX "document_approvals_pending_idx" ON "document_approvals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "document_links_to_idx" ON "document_links" USING btree ("to_document_id");--> statement-breakpoint
CREATE INDEX "documents_type_status_idx" ON "documents" USING btree ("tenant_id","doc_type","status");--> statement-breakpoint
CREATE INDEX "documents_date_idx" ON "documents" USING btree ("tenant_id","doc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_uq" ON "documents" USING btree ("tenant_id","company_id","doc_type","number") WHERE "documents"."number" is not null;--> statement-breakpoint
CREATE INDEX "documents_number_trgm_idx" ON "documents" USING gin ("number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "number_series_lookup_idx" ON "number_series" USING btree ("tenant_id","company_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "number_series_name_uq" ON "number_series" USING btree ("tenant_id","company_id","doc_type","name");--> statement-breakpoint
CREATE INDEX "pr_lines_requisition_idx" ON "purchase_requisition_lines" USING btree ("requisition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_lines_line_no_uq" ON "purchase_requisition_lines" USING btree ("requisition_id","line_no");