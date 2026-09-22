CREATE TYPE "public"."sign_in_audience" AS ENUM('donor', 'staff');--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "audience" "sign_in_audience" DEFAULT 'donor' NOT NULL;