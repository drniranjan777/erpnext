CREATE TABLE "svc_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"views" smallint DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"value" numeric(16, 2) DEFAULT '0' NOT NULL,
	"visits_per_year" smallint DEFAULT 0 NOT NULL,
	"serials" text[] DEFAULT '{}' NOT NULL,
	"resolution_minutes" smallint,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_rmas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text,
	"ticket_id" uuid,
	"reason" text NOT NULL,
	"under_warranty" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'authorised' NOT NULL,
	"received_at" timestamp with time zone,
	"diagnosis" text,
	"repair_notes" text,
	"replacement_serial" text,
	"returned_at" timestamp with time zone,
	"dispatch_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"targets" jsonb NOT NULL,
	"business_hours" jsonb,
	"escalate_to_id" uuid,
	"default_warranty_months" smallint DEFAULT 12 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid,
	"contact_name" text,
	"contact_email" "citext",
	"contact_phone" text,
	"channel" text DEFAULT 'phone' NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'query' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"item_id" uuid,
	"serial_no" text,
	"warranty_id" uuid,
	"contract_id" uuid,
	"assignee_id" uuid,
	"response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"escalation_level" smallint DEFAULT 0 NOT NULL,
	"resolution" text,
	"rating" smallint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_visits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"party_id" uuid NOT NULL,
	"ticket_id" uuid,
	"contract_id" uuid,
	"item_id" uuid,
	"serial_no" text,
	"technician_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"work_done" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock_entry_id" uuid,
	"chargeable" boolean DEFAULT false NOT NULL,
	"signed_by" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_warranties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" "citext" NOT NULL,
	"invoice_id" uuid,
	"sale_date" date,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "svc_articles" ADD CONSTRAINT "svc_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_articles" ADD CONSTRAINT "svc_articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_contracts" ADD CONSTRAINT "svc_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_contracts" ADD CONSTRAINT "svc_contracts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_rmas" ADD CONSTRAINT "svc_rmas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_rmas" ADD CONSTRAINT "svc_rmas_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_rmas" ADD CONSTRAINT "svc_rmas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_rmas" ADD CONSTRAINT "svc_rmas_ticket_id_svc_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."svc_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_rmas" ADD CONSTRAINT "svc_rmas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_settings" ADD CONSTRAINT "svc_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_settings" ADD CONSTRAINT "svc_settings_escalate_to_id_users_id_fk" FOREIGN KEY ("escalate_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_ticket_events" ADD CONSTRAINT "svc_ticket_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_ticket_events" ADD CONSTRAINT "svc_ticket_events_ticket_id_svc_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."svc_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_ticket_events" ADD CONSTRAINT "svc_ticket_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_warranty_id_svc_warranties_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."svc_warranties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_contract_id_svc_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."svc_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_tickets" ADD CONSTRAINT "svc_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_ticket_id_svc_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."svc_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_contract_id_svc_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."svc_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_visits" ADD CONSTRAINT "svc_visits_stock_entry_id_documents_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_warranties" ADD CONSTRAINT "svc_warranties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_warranties" ADD CONSTRAINT "svc_warranties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_warranties" ADD CONSTRAINT "svc_warranties_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_warranties" ADD CONSTRAINT "svc_warranties_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_warranties" ADD CONSTRAINT "svc_warranties_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "svc_articles_search_idx" ON "svc_articles" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_contracts_number_uq" ON "svc_contracts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "svc_contracts_party_idx" ON "svc_contracts" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_rmas_number_uq" ON "svc_rmas" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_settings_tenant_uq" ON "svc_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "svc_ticket_events_idx" ON "svc_ticket_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_tickets_number_uq" ON "svc_tickets" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "svc_tickets_status_idx" ON "svc_tickets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "svc_tickets_party_idx" ON "svc_tickets" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_visits_number_uq" ON "svc_visits" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "svc_visits_tech_idx" ON "svc_visits" USING btree ("tenant_id","technician_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_warranties_serial_uq" ON "svc_warranties" USING btree ("tenant_id","item_id","serial_no");