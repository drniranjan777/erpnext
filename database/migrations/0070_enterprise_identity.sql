CREATE TABLE "scim_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"default_role_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"protocol" text DEFAULT 'oidc' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer" text,
	"client_id" text,
	"client_secret_encrypted" text,
	"idp_entity_id" text,
	"idp_sso_url" text,
	"idp_certificate" text,
	"allowed_domains" text[] DEFAULT '{}' NOT NULL,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"default_role_id" uuid,
	"require_sso" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_settings" ADD CONSTRAINT "sso_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_settings" ADD CONSTRAINT "sso_settings_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_hash_uq" ON "scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_tokens_tenant_idx" ON "scim_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_settings_tenant_uq" ON "sso_settings" USING btree ("tenant_id");