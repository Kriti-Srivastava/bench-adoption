CREATE TYPE "public"."maintenance_priority" AS ENUM('low', 'normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('open', 'scheduled', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('inspection', 'repair', 'painting', 'cleaning', 'graffiti', 'plaque', 'relocation', 'other');--> statement-breakpoint
CREATE TABLE "maintenance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bench_id" uuid NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"status" "maintenance_status" DEFAULT 'open' NOT NULL,
	"priority" "maintenance_priority" DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"reported_by_id" uuid,
	"assignee_id" uuid,
	"adoption_id" uuid,
	"scheduled_for" date,
	"completed_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_title_length" CHECK (char_length("maintenance_tasks"."title") between 1 and 120),
	CONSTRAINT "maintenance_completed_when_done" CHECK (("maintenance_tasks"."status" = 'done') = ("maintenance_tasks"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_bench_id_benches_id_fk" FOREIGN KEY ("bench_id") REFERENCES "public"."benches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_adoption_id_adoptions_id_fk" FOREIGN KEY ("adoption_id") REFERENCES "public"."adoptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_bench_idx" ON "maintenance_tasks" USING btree ("bench_id");--> statement-breakpoint
CREATE INDEX "maintenance_open_idx" ON "maintenance_tasks" USING btree ("status","priority") WHERE "maintenance_tasks"."status" in ('open', 'scheduled', 'in_progress');--> statement-breakpoint
CREATE INDEX "maintenance_reporter_idx" ON "maintenance_tasks" USING btree ("reported_by_id");