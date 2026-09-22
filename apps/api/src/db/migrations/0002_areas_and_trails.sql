CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"park_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"facts" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bench_trails" (
	"bench_id" uuid NOT NULL,
	"trail_id" uuid NOT NULL,
	CONSTRAINT "bench_trails_bench_id_trail_id_pk" PRIMARY KEY("bench_id","trail_id")
);
--> statement-breakpoint
CREATE TABLE "trails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"park_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"length_miles" real,
	"facts" text[] DEFAULT '{}'::text[] NOT NULL,
	"path" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benches" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_trails" ADD CONSTRAINT "bench_trails_bench_id_benches_id_fk" FOREIGN KEY ("bench_id") REFERENCES "public"."benches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_trails" ADD CONSTRAINT "bench_trails_trail_id_trails_id_fk" FOREIGN KEY ("trail_id") REFERENCES "public"."trails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_park_name_unique" ON "areas" USING btree ("park_id","name");--> statement-breakpoint
CREATE INDEX "bench_trails_trail_idx" ON "bench_trails" USING btree ("trail_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trails_park_slug_unique" ON "trails" USING btree ("park_id","slug");--> statement-breakpoint
ALTER TABLE "benches" ADD CONSTRAINT "benches_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benches_area_idx" ON "benches" USING btree ("area_id");--> statement-breakpoint
-- Backfill: turn each bench's free-text zone into an area row and link to it.
INSERT INTO "areas" ("park_id", "name") SELECT DISTINCT "park_id", "zone" FROM "benches";--> statement-breakpoint
UPDATE "benches" b SET "area_id" = a."id" FROM "areas" a WHERE a."park_id" = b."park_id" AND a."name" = b."zone";
