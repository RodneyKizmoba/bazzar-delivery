ALTER TABLE "store_invoices" ADD COLUMN "store_vat_regime" text;--> statement-breakpoint
ALTER TABLE "store_invoices" ADD COLUMN "pedeja_vat_regime" text;--> statement-breakpoint
ALTER TABLE "store_invoices" ADD COLUMN "vat_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "seller_type" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "vat_regime" text DEFAULT 'exclusion' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "vat_regime_raised_at" timestamp;