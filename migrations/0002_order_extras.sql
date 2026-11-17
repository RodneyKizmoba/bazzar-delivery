ALTER TABLE "orders" ADD COLUMN "priority_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_tip" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cutlery" boolean DEFAULT false NOT NULL;