-- A bench can't have two active adoptions whose date ranges overlap.
-- Ranges are [start_date, end_date): a renewal starting on the day the
-- previous adoption ends does not overlap it. Enforcing this in the database
-- means two people adopting the same bench at the same moment can't both win.
-- (Drizzle can't express exclusion constraints, hence this custom migration.)
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_no_overlap"
  EXCLUDE USING gist (
    "bench_id" WITH =,
    daterange("start_date", "end_date", '[)') WITH &&
  ) WHERE ("status" = 'active');
