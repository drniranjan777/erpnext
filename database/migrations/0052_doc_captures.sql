CREATE TABLE "ai_doc_captures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text,
	"source" text NOT NULL,
	"confidence" numeric(4, 2),
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matches" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_doc_captures" ADD CONSTRAINT "ai_doc_captures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_doc_captures" ADD CONSTRAINT "ai_doc_captures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_doc_captures" ADD CONSTRAINT "ai_doc_captures_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_doc_captures_idx" ON "ai_doc_captures" USING btree ("tenant_id","status","created_at");