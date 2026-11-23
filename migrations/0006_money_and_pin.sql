CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_type" text NOT NULL,
	"party_id" integer NOT NULL,
	"order_id" integer,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"reference" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_pin" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_pin_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_pct" real;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "store_earning" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_earning" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "commission_pct" real;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_party_idx" ON "ledger_entries" USING btree ("party_type","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_order_once_idx" ON "ledger_entries" USING btree ("party_type","party_id","order_id","kind");