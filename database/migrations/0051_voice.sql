CREATE TABLE "ai_voice_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"lang" text NOT NULL,
	"text" text NOT NULL,
	"normalised" text,
	"command" text,
	"parsed" jsonb,
	"outcome" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_voice_logs" ADD CONSTRAINT "ai_voice_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_voice_logs" ADD CONSTRAINT "ai_voice_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_voice_logs_idx" ON "ai_voice_logs" USING btree ("tenant_id","created_at");