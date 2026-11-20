ALTER TABLE "orders" ADD COLUMN "driver_assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "driver_at_store_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "driver_at_customer_at" timestamp;