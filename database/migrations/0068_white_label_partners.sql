CREATE TABLE "partner_commissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"client_tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"base_amount" double precision NOT NULL,
	"rate_pct" double precision NOT NULL,
	"amount" double precision NOT NULL,
	"status" text DEFAULT 'accrued' NOT NULL,
	"payout_ref" text,
	"accrued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"gstin" text,
	"commission_pct" double precision DEFAULT 0 NOT NULL,
	"certified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_name" text,
	"logo" text,
	"primary_color" text,
	"accent_color" text,
	"support_email" text,
	"email_from_name" text,
	"email_from_address" text,
	"email_domain_token" text,
	"email_domain_verified_at" timestamp with time zone,
	"sms_sender_id" text,
	"sms_entity_id" text,
	"custom_domain" "citext",
	"domain_token" text,
	"domain_verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commissions_invoice_uq" ON "partner_commissions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "partner_commissions_partner_idx" ON "partner_commissions" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_members_uq" ON "partner_members" USING btree ("partner_id","user_id");--> statement-breakpoint
CREATE INDEX "partner_members_user_idx" ON "partner_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_code_uq" ON "partners" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_branding_tenant_uq" ON "tenant_branding" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_branding_domain_uq" ON "tenant_branding" USING btree ("custom_domain");