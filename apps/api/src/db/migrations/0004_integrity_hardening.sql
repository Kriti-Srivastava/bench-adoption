-- Integrity hardening. Ordered so each step's prerequisites exist first, and
-- existing rows are backfilled before new NOT NULL / FK rules apply.

-- 1. Composite keys that the same-park foreign keys will reference.
ALTER TABLE "areas" ADD CONSTRAINT "areas_id_park_unique" UNIQUE("id","park_id");--> statement-breakpoint
ALTER TABLE "benches" ADD CONSTRAINT "benches_id_park_unique" UNIQUE("id","park_id");--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_id_park_unique" UNIQUE("id","park_id");--> statement-breakpoint

-- 2. A bench's area must be in the bench's park.
ALTER TABLE "benches" DROP CONSTRAINT "benches_area_id_areas_id_fk";--> statement-breakpoint
ALTER TABLE "benches" ADD CONSTRAINT "benches_area_same_park_fk" FOREIGN KEY ("area_id","park_id") REFERENCES "public"."areas"("id","park_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 3. A bench and a trail can only be linked within one park.
ALTER TABLE "bench_trails" DROP CONSTRAINT "bench_trails_bench_id_benches_id_fk";--> statement-breakpoint
ALTER TABLE "bench_trails" DROP CONSTRAINT "bench_trails_trail_id_trails_id_fk";--> statement-breakpoint
ALTER TABLE "bench_trails" ADD COLUMN "park_id" uuid;--> statement-breakpoint
UPDATE "bench_trails" bt SET "park_id" = b."park_id" FROM "benches" b WHERE b."id" = bt."bench_id";--> statement-breakpoint
ALTER TABLE "bench_trails" ALTER COLUMN "park_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bench_trails" ADD CONSTRAINT "bench_trails_bench_same_park_fk" FOREIGN KEY ("bench_id","park_id") REFERENCES "public"."benches"("id","park_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_trails" ADD CONSTRAINT "bench_trails_trail_same_park_fk" FOREIGN KEY ("trail_id","park_id") REFERENCES "public"."trails"("id","park_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 4. Value checks the API already enforces, now also enforced for imports and scripts.
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_display_name_length" CHECK (char_length("adoptions"."display_name") between 1 and 80);--> statement-breakpoint
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_dedication_length" CHECK (char_length("adoptions"."dedication") <= 280);--> statement-breakpoint
ALTER TABLE "benches" ADD CONSTRAINT "benches_lat_range" CHECK ("benches"."lat" between -90 and 90);--> statement-breakpoint
ALTER TABLE "benches" ADD CONSTRAINT "benches_lng_range" CHECK ("benches"."lng" between -180 and 180);--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_length_non_negative" CHECK ("trails"."length_miles" is null or "trails"."length_miles" >= 0);--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_path_is_line" CHECK (jsonb_typeof("trails"."path") = 'array' and jsonb_array_length("trails"."path") >= 2);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"));--> statement-breakpoint

-- 5. Index for "ending soon" lists and the daily reminder job.
CREATE INDEX "adoptions_active_end_idx" ON "adoptions" USING btree ("end_date") WHERE "adoptions"."status" = 'active';
