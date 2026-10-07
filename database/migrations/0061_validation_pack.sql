CREATE TABLE "val_approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document" text NOT NULL,
	"role" text NOT NULL,
	"signature_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "val_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_version" text NOT NULL,
	"modules" jsonb NOT NULL,
	"gamp_category" smallint DEFAULT 4 NOT NULL,
	"intended_use" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"risks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "val_tests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"protocol" text NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"requirement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected" text NOT NULL,
	"automated" text,
	"actual" text,
	"result" text DEFAULT 'pending' NOT NULL,
	"evidence" text,
	"deviation_id" uuid,
	"executed_by" uuid,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "val_approvals" ADD CONSTRAINT "val_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_approvals" ADD CONSTRAINT "val_approvals_project_id_val_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."val_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_approvals" ADD CONSTRAINT "val_approvals_signature_id_e_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_projects" ADD CONSTRAINT "val_projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_projects" ADD CONSTRAINT "val_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_tests" ADD CONSTRAINT "val_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_tests" ADD CONSTRAINT "val_tests_project_id_val_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."val_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "val_tests" ADD CONSTRAINT "val_tests_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "val_approvals_idx" ON "val_approvals" USING btree ("tenant_id","project_id","document");--> statement-breakpoint
CREATE INDEX "val_projects_idx" ON "val_projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "val_tests_ref_uq" ON "val_tests" USING btree ("tenant_id","project_id","ref");--> statement-breakpoint
CREATE INDEX "val_tests_project_idx" ON "val_tests" USING btree ("tenant_id","project_id","protocol");