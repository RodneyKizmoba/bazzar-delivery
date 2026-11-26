CREATE TABLE "store_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"store_id" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"store_name" text NOT NULL,
	"store_nif" text,
	"store_address" text NOT NULL,
	"lines" jsonb NOT NULL,
	"sales_total" integer NOT NULL,
	"commission_total" integer NOT NULL,
	"ads_total" integer NOT NULL,
	"net_total" integer NOT NULL,
	"vat_pct" real NOT NULL,
	"vat_amount" integer NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"agt_invoice_number" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"issued_by" integer,
	"voided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "commission_pct" real;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "commission_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "plan" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "counter_price" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "commission_free_until" timestamp;--> statement-breakpoint
ALTER TABLE "store_invoices" ADD CONSTRAINT "store_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_invoices_number_idx" ON "store_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "store_invoices_store_idx" ON "store_invoices" USING btree ("store_id");