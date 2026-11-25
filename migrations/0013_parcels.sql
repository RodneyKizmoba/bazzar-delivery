ALTER TABLE "orders" ADD COLUMN "kind" text DEFAULT 'food' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "parcel" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;