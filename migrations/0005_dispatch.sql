CREATE TABLE "dispatch_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"round" integer NOT NULL,
	"distance_km" real,
	"payout" integer NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "driver_presence" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"latitude" real,
	"longitude" real,
	"location_at" timestamp,
	"online_since" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "prep_minutes" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ready_estimate_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dispatch_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dispatch_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dispatch_failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_offers_order_idx" ON "dispatch_offers" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "dispatch_offers_driver_idx" ON "dispatch_offers" USING btree ("driver_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_offers_one_pending_idx" ON "dispatch_offers" ("order_id") WHERE "status" = 'pending';