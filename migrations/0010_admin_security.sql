CREATE TABLE "admin_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"status" integer,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_recovery" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_user_idx" ON "admin_audit" USING btree ("user_id");