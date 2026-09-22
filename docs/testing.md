# Testing

```sh
npm test                          # unit + integration (needs the database running)
npm run test:chaos -w @bench/api  # chaos suite, deliberately destructive
npm run typecheck
```

The integration tests run against a real PostgreSQL. The test database is
rebuilt from the migrations before each run, so a fresh install is proven
every time.

## What the normal suite covers

- Browsing, filtering, trails, pagination and caching headers.
- Adopting, renewing, expiry, cancellation and the park's adoption terms.
- Concurrency: eight simultaneous adoptions of one bench leave exactly one
  winner and seven clean refusals.
- Rules the database enforces, written directly through repositories to prove
  they hold even when application code is bypassed.
- Sign-in: single-use links, expiry, per-address rate limits, sessions.
- Staff tools: retiring (keep / end / relocate), restoring, maintenance jobs,
  CSV import and export, user roles.
- Events and the email outbox: retries with backoff, giving up after five
  attempts, and two workers never sending the same message twice.
- Privacy: the exact list of publicly cacheable routes, and that private
  responses are never stored by a browser or CDN.

## The chaos suite

In the spirit of Netflix's Chaos Monkey: break things while the system is
busy, then check that every request got an answer, the data rules still hold,
and the system recovers.

**The monkeys** (`chaos/monkey.ts`)

- kill random PostgreSQL connections mid-request;
- make the mail provider fail most of the time and stall the rest;
- leap the clock forward by hours or months;
- send crowds of simultaneous requests at a single bench.

**The workload** (`chaos/workload.ts`) fires random mixes of adopt, renew,
cancel, retire (keep, end or relocate), restore, report and close-task in
concurrent waves through the real HTTP API.

**The rules** (`chaos/invariants.ts`) are checked in SQL afterwards:

- no two active adoptions of a bench overlap;
- a renewal starts the day its predecessor ends, on the same bench;
- no active renewal of a cancelled adoption;
- nothing adopted on a retired bench, except an adoption its retirement kept;
- no plaque work left open for a cancelled adoption;
- every new adoption has its plaque job;
- no reminder recorded twice;
- benches, areas and trails never cross parks.

**Reproducible.** Each run prints its seed; `CHAOS_SEED=<seed>` replays it
exactly.

The suite found real bugs: adoptions landing on benches that were being
retired, renewals surviving a cancellation, and a sign-in lockout during a
mail outage. All six scenarios pass now.

A note on writing these tests: two early "failures" were mistakes in the
checks themselves, both comparing the tests' simulated clock with the
database's real clock. The rule now is that anything the application compares
against, the application stamps.
