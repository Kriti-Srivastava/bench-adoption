-- Guards that keep adoption state consistent even under concurrency, and even
-- for code paths that bypass the application's bench locks. Each check reads
-- the row it depends on FOR SHARE, so a concurrent retirement or cancellation
-- waits for the insert to commit (and vice versa): no check-then-act race.
-- Violations raise custom SQLSTATEs (class BA) that the API maps to 409s.

-- 1. An adoption can only become active on (or move to) a bench in the program.
--    An adoption already active on a bench that is later retired may stay
--    (the "keep until it ends" choice); it just can't be created or moved there.
CREATE FUNCTION adoptions_require_active_bench() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.bench_id = OLD.bench_id THEN
    RETURN NEW;
  END IF;
  IF (SELECT status FROM benches WHERE id = NEW.bench_id FOR SHARE) <> 'active' THEN
    RAISE EXCEPTION 'bench % is not in the adoption program', NEW.bench_id USING ERRCODE = 'BA001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER adoptions_require_active_bench
  BEFORE INSERT OR UPDATE OF bench_id, status ON adoptions
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION adoptions_require_active_bench();
--> statement-breakpoint

-- 2. A renewal can only be active while the adoption it continues is active.
CREATE FUNCTION adoptions_require_active_predecessor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'active'
     AND NEW.renewed_from_id IS NOT DISTINCT FROM OLD.renewed_from_id THEN
    RETURN NEW;
  END IF;
  IF (SELECT status FROM adoptions WHERE id = NEW.renewed_from_id FOR SHARE) <> 'active' THEN
    RAISE EXCEPTION 'adoption % is not active', NEW.renewed_from_id USING ERRCODE = 'BA002';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER adoptions_require_active_predecessor
  BEFORE INSERT OR UPDATE OF renewed_from_id, status ON adoptions
  FOR EACH ROW WHEN (NEW.status = 'active' AND NEW.renewed_from_id IS NOT NULL)
  EXECUTE FUNCTION adoptions_require_active_predecessor();
