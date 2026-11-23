CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_type" text NOT NULL,
	"party_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"method" text,
	"account" text,
	"period_end" timestamp,
	"bank_reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD COLUMN "pay_detail" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "service_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "small_order_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_km" real;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "busy_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_pay" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_pay_detail" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_wait_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vehicle_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payout_method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payout_reference" text;--> statement-breakpoint
CREATE INDEX "payouts_party_idx" ON "payouts" USING btree ("party_type","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_weekly_once_idx" ON "payouts" USING btree ("party_type","party_id","kind","period_end");--> statement-breakpoint
UPDATE "users" SET "vehicle_type" = 'moto' WHERE "user_type" = 'driver' AND "vehicle_type" IS NULL;