CREATE TABLE "cad_file_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cad_file_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"revision" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"note" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cad_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" "citext" NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"item_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"references" uuid[] DEFAULT '{}' NOT NULL,
	"revision" text DEFAULT 'A' NOT NULL,
	"status" text DEFAULT 'in_work' NOT NULL,
	"checked_out_by" uuid,
	"checked_out_at" timestamp with time zone,
	"release_signature_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"title" text NOT NULL,
	"doc_no" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"content" text,
	"retention_until" date,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disposed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dms_folders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"retention_years" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"signer_id" uuid,
	"signer_name" text NOT NULL,
	"reason" text,
	"sha256" char(64) NOT NULL,
	"certificate" jsonb NOT NULL,
	"signature" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text,
	"note" text,
	"text_extracted" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plm_eboms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"release_signature_id" uuid,
	"mbom_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plm_item_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"stage" text DEFAULT 'concept' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cad_file_versions" ADD CONSTRAINT "cad_file_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_file_versions" ADD CONSTRAINT "cad_file_versions_cad_file_id_cad_files_id_fk" FOREIGN KEY ("cad_file_id") REFERENCES "public"."cad_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_file_versions" ADD CONSTRAINT "cad_file_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_files" ADD CONSTRAINT "cad_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_files" ADD CONSTRAINT "cad_files_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_files" ADD CONSTRAINT "cad_files_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_files" ADD CONSTRAINT "cad_files_release_signature_id_e_signatures_id_fk" FOREIGN KEY ("release_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_files" ADD CONSTRAINT "dms_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_files" ADD CONSTRAINT "dms_files_folder_id_dms_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."dms_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_files" ADD CONSTRAINT "dms_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_folders" ADD CONSTRAINT "dms_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_folders" ADD CONSTRAINT "dms_folders_parent_id_dms_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dms_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_signatures" ADD CONSTRAINT "dms_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_signatures" ADD CONSTRAINT "dms_signatures_version_id_dms_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."dms_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_signatures" ADD CONSTRAINT "dms_signatures_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_versions" ADD CONSTRAINT "dms_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_versions" ADD CONSTRAINT "dms_versions_file_id_dms_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."dms_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_versions" ADD CONSTRAINT "dms_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_eboms" ADD CONSTRAINT "plm_eboms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_eboms" ADD CONSTRAINT "plm_eboms_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_eboms" ADD CONSTRAINT "plm_eboms_release_signature_id_e_signatures_id_fk" FOREIGN KEY ("release_signature_id") REFERENCES "public"."e_signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_eboms" ADD CONSTRAINT "plm_eboms_mbom_id_documents_id_fk" FOREIGN KEY ("mbom_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_eboms" ADD CONSTRAINT "plm_eboms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_item_states" ADD CONSTRAINT "plm_item_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plm_item_states" ADD CONSTRAINT "plm_item_states_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cad_file_versions_uq" ON "cad_file_versions" USING btree ("cad_file_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cad_files_number_uq" ON "cad_files" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "dms_files_folder_idx" ON "dms_files" USING btree ("tenant_id","folder_id");--> statement-breakpoint
CREATE INDEX "dms_files_retention_idx" ON "dms_files" USING btree ("tenant_id","retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_folders_name_uq" ON "dms_folders" USING btree ("tenant_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "dms_signatures_version_idx" ON "dms_signatures" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dms_versions_uq" ON "dms_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plm_eboms_rev_uq" ON "plm_eboms" USING btree ("tenant_id","item_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "plm_item_states_item_uq" ON "plm_item_states" USING btree ("tenant_id","item_id");