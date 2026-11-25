ALTER TYPE "public"."user_type" ADD VALUE 'taxi';--> statement-breakpoint
CREATE TABLE "ride_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"ride_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"round" integer NOT NULL,
	"pickup_km" real,
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" serial PRIMARY KEY NOT NULL,
	"ride_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"driver_id" integer,
	"category" text NOT NULL,
	"status" text DEFAULT 'searching' NOT NULL,
	"pickup" jsonb NOT NULL,
	"dropoff" jsonb NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"est_km" real NOT NULL,
	"est_min" real NOT NULL,
	"fare" integer NOT NULL,
	"fare_detail" jsonb NOT NULL,
	"wait_fee" integer DEFAULT 0 NOT NULL,
	"cancel_fee" integer DEFAULT 0 NOT NULL,
	"tip" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"pin" text NOT NULL,
	"pin_attempts" integer DEFAULT 0 NOT NULL,
	"share_token" text NOT NULL,
	"dispatch_round" integer DEFAULT 0 NOT NULL,
	"search_started_at" timestamp DEFAULT now() NOT NULL,
	"driver_latitude" real,
	"driver_longitude" real,
	"driver_location_at" timestamp,
	"commission_pct" real,
	"commission_amount" integer,
	"driver_earning" integer,
	"settled_at" timestamp,
	"rating" integer,
	"rating_comment" text,
	"cancel_reason" text,
	"cancelled_by" text,
	"sos_at" timestamp,
	"sos_by" text,
	"accepted_at" timestamp,
	"arrived_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxi_drivers" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"colour" text NOT NULL,
	"plate" text NOT NULL,
	"year" integer,
	"licence_number" text NOT NULL,
	"rating_avg" real DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "ride_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "ride_id" integer;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxi_drivers" ADD CONSTRAINT "taxi_drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_offers_ride_idx" ON "ride_offers" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_offers_driver_idx" ON "ride_offers" USING btree ("driver_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_number_idx" ON "rides" USING btree ("ride_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_share_idx" ON "rides" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "rides_customer_idx" ON "rides" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_ride_once_idx" ON "ledger_entries" USING btree ("party_type","party_id","ride_id","kind");