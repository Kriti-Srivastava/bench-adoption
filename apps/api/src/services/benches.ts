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
import { PG, pgErrorCode } from '../db/client.ts';
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

  return {
    async getPark(slug: string): Promise<Park> {
      const { park } = await requirePark(slug);
      const zones = await parkRepo.listZones(db, park.id);
      return { id: park.id, slug: park.slug, name: park.name, timezone: park.timezone, zones };
    },

    async listBenches(slug: string, query: ListBenchesQuery & { limit: number }): Promise<BenchList> {
      const { park, today } = await requirePark(slug);
      // Fetch one extra row to learn whether another page exists.
      const rows = await benchRepo.listBenches(db, {
        parkId: park.id,
        today,
        availability: query.availability,
        zone: query.zone,
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
      const { park } = await requirePark(slug);
      const values = createBenchInput.parse(input);
      const bench = await saveBench(() => benchRepo.insertBench(db, { ...values, parkId: park.id }));
      // A new bench is active and unadopted by definition.
      return toBenchSummary({ bench, current: null, availability: 'available' });
    },

    async updateBench(id: string, input: UpdateBenchInput): Promise<BenchSummary> {
      const bench = await saveBench(() => benchRepo.updateBench(db, id, input));
      if (!bench) throw notFound('Bench');
      const found = await benchRepo.findBenchWithTimezone(db, id);
      const today = todayIn(found!.timezone, ctx.clock.now());
      return toBenchSummary((await benchRepo.findBench(db, { id }, today))!);
    },

    /**
     * Imports benches from CSV with columns code,name,zone,lat,lng[,description].
     * Existing codes are updated, so the same file can be re-imported safely.
     */
    async importCsv(slug: string, csv: string): Promise<ImportBenchesResult> {
      const { park } = await requirePark(slug);
      const records: Record<string, string>[] = parse(csv, {
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

      return db.transaction((tx) => benchRepo.upsertBenches(tx, park.id, rows));
    },
  };
}

export type BenchService = ReturnType<typeof createBenchService>;
