ALTER TABLE "stores" ADD COLUMN "pos_key_hash" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pos_key_hint" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pos_webhook_url" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pos_webhook_secret" text;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_pos_key_hash_unique" UNIQUE("pos_key_hash");