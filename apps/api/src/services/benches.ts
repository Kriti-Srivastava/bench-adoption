import { parse } from 'csv-parse/sync';
import {
  createBenchInput,
  todayIn,
  type BenchDetail,
  type BenchList,
  type CreateBenchInput,
  type ImportBenchesResult,
  type ListBenchesQuery,
  type Park,
  type UpdateBenchInput,
  type BenchSummary,
} from '@bench/shared';
import { PG, pgErrorCode, type Executor } from '../db/client.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as parkRepo from '../repositories/parks.ts';
import { firstFreeDate } from './availability.ts';
import type { AppContext } from './context.ts';
import { toBenchSummary } from './mappers.ts';

export function createBenchService(ctx: AppContext) {
  const { db } = ctx;

  async function requirePark(slug: string) {
    const park = await parkRepo.findParkBySlug(db, slug);
    if (!park) throw notFound('Park');
    return { park, today: todayIn(park.timezone, ctx.clock.now()) };
  }

  async function saveBench<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (pgErrorCode(err) === PG.uniqueViolation) {
        throw conflict('duplicate_code', 'A bench with that plaque code already exists.');
      }
      throw err;
    }
  }

  /**
   * Turns the area names and trail slugs used by the API into database ids,
   * creating new areas on first use. Unknown trails are an error, since
   * trails are curated rather than typed in freely.
   */
  async function resolvePlaces(
    tx: Executor,
    parkId: string,
    rows: { zone?: string; trails?: string[] }[],
  ) {
    const areaIds = await parkRepo.ensureAreas(
      tx,
      parkId,
      rows.flatMap((r) => (r.zone === undefined ? [] : [r.zone])),
    );
    const slugs = [...new Set(rows.flatMap((r) => r.trails ?? []))];
    const trailIds = await parkRepo.trailIdsBySlug(tx, parkId, slugs);
    const unknown = slugs.filter((s) => !trailIds.has(s));
    if (unknown.length > 0) throw badRequest('unknown_trail', `Unknown trail: ${unknown.join(', ')}`);
    return {
      areaId: (name: string) => areaIds.get(name)!,
      trailIds: (list: string[]) => list.map((s) => trailIds.get(s)!),
    };
  }

  return {
    async getPark(slug: string): Promise<Park> {
      const { park } = await requirePark(slug);
      const [areaRows, trailRows] = await Promise.all([
        parkRepo.listAreas(db, park.id),
        parkRepo.listTrails(db, park.id),
      ]);
      return {
        id: park.id,
        slug: park.slug,
        name: park.name,
        timezone: park.timezone,
        areas: areaRows.map((a) => ({ name: a.name, description: a.description, facts: a.facts })),
        trails: trailRows.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          lengthMiles: t.lengthMiles,
          facts: t.facts,
          path: t.path,
        })),
      };
    },

    async listBenches(slug: string, query: ListBenchesQuery & { limit: number }): Promise<BenchList> {
      const { park, today } = await requirePark(slug);
      // Fetch one extra row to learn whether another page exists.
      const rows = await benchRepo.listBenches(db, {
        parkId: park.id,
        today,
        availability: query.availability,
        zone: query.zone,
        trail: query.trail,
        q: query.q,
        afterCode: query.cursor,
        limit: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const hasMore = rows.length > query.limit;
      return {
        items: page.map(toBenchSummary),
        nextCursor: hasMore ? page[page.length - 1]!.bench.code : null,
      };
    },

    async getBench(slug: string, code: string): Promise<BenchDetail> {
      const { park, today } = await requirePark(slug);
      const found = await benchRepo.findBench(db, { parkId: park.id, code }, today);
      if (!found) throw notFound('Bench');
      const upcoming = await benchRepo.listUpcomingAdoptions(db, found.bench.id, today);
      return {
        ...toBenchSummary(found),
        description: found.bench.description,
        availableFrom: firstFreeDate(today, upcoming),
      };
    },

    async createBench(slug: string, input: CreateBenchInput): Promise<BenchSummary> {
      const { park, today } = await requirePark(slug);
      const { zone, trails, ...values } = createBenchInput.parse(input);
      const id = await saveBench(() =>
        db.transaction(async (tx) => {
          const places = await resolvePlaces(tx, park.id, [{ zone, trails }]);
          const bench = await benchRepo.insertBench(tx, {
            ...values,
            parkId: park.id,
            areaId: places.areaId(zone),
          });
          if (trails) await parkRepo.setBenchTrails(tx, [{ benchId: bench.id, trailIds: places.trailIds(trails) }]);
          return bench.id;
        }),
      );
      return toBenchSummary((await benchRepo.findBench(db, { id }, today))!);
    },

    async updateBench(id: string, input: UpdateBenchInput): Promise<BenchSummary> {
      const found = await benchRepo.findBenchWithTimezone(db, id);
      if (!found) throw notFound('Bench');
      const { zone, trails, ...values } = input;
      await saveBench(() =>
        db.transaction(async (tx) => {
          const places = await resolvePlaces(tx, found.bench.parkId, [{ zone, trails }]);
          await benchRepo.updateBench(tx, id, {
            ...values,
            ...(zone === undefined ? {} : { areaId: places.areaId(zone) }),
          });
          if (trails) await parkRepo.setBenchTrails(tx, [{ benchId: id, trailIds: places.trailIds(trails) }]);
        }),
      );
      const today = todayIn(found.timezone, ctx.clock.now());
      return toBenchSummary((await benchRepo.findBench(db, { id }, today))!);
    },

    /**
     * Imports benches from CSV with columns code,name,zone,lat,lng and optional
     * description and trails (trail slugs separated by ";"). Existing codes
     * are updated, so the same file can be re-imported safely.
     */
    async importCsv(slug: string, csv: string): Promise<ImportBenchesResult> {
      const { park } = await requirePark(slug);
      const records: Record<string, string | undefined>[] = parse(csv, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      });

      const rows = records.map((r, i) => {
        const result = createBenchInput.safeParse({
          code: r.code,
          name: r.name,
          zone: r.zone,
          lat: Number(r.lat),
          lng: Number(r.lng),
          description: r.description || null,
          trails: r.trails?.split(';').map((t) => t.trim()).filter(Boolean),
        });
        if (!result.success) {
          const issue = result.error.issues[0]!;
          // +2: header line, and rows are 1-based for humans.
          throw badRequest(
            'invalid_csv',
            `Row ${i + 2}: ${issue.path.join('.') || 'row'} ${issue.message}`,
          );
        }
        return result.data;
      });

      const codes = new Set<string>();
      for (const r of rows) {
        if (codes.has(r.code)) throw badRequest('invalid_csv', `Duplicate code in file: ${r.code}`);
        codes.add(r.code);
      }

      return db.transaction(async (tx) => {
        const places = await resolvePlaces(tx, park.id, rows);
        const { created, updated, ids } = await benchRepo.upsertBenches(
          tx,
          park.id,
          rows.map(({ zone, trails: _trails, ...r }) => ({ ...r, areaId: places.areaId(zone) })),
        );
        await parkRepo.setBenchTrails(
          tx,
          rows
            .filter((r) => r.trails !== undefined)
            .map((r) => ({ benchId: ids.get(r.code)!, trailIds: places.trailIds(r.trails!) })),
        );
        return { created, updated };
      });
    },
  };
}

export type BenchService = ReturnType<typeof createBenchService>;
