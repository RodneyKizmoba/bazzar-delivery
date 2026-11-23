CREATE TABLE "sponsorships" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"days" integer NOT NULL,
	"price" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"refund" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfilment" text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "offers_pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "own_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sponsorships_store_idx" ON "sponsorships" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "sponsorships_active_idx" ON "sponsorships" USING btree ("status","ends_at");