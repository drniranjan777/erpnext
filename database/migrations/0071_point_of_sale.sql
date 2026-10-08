CREATE TABLE "pos_sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text DEFAULT 'sale' NOT NULL,
	"number" text NOT NULL,
	"client_ref" text NOT NULL,
	"buyer_name" text,
	"buyer_mobile" text,
	"buyer_gstin" text,
	"lines" jsonb NOT NULL,
	"taxable" double precision NOT NULL,
	"tax" double precision NOT NULL,
	"total" double precision NOT NULL,
	"tenders" jsonb NOT NULL,
	"change" double precision DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"return_of_id" uuid,
	"sold_by" uuid,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"opened_by" uuid,
	"opening_cash" double precision DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"z_report" jsonb
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"customer_id" uuid,
	"receipt_footer" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_session_id_pos_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pos_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_terminal_id_pos_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."pos_terminals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sales_ref_uq" ON "pos_sales" USING btree ("tenant_id","client_ref");--> statement-breakpoint
CREATE INDEX "pos_sales_session_idx" ON "pos_sales" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "pos_sessions_terminal_idx" ON "pos_sessions" USING btree ("tenant_id","terminal_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_code_uq" ON "pos_terminals" USING btree ("tenant_id","code");