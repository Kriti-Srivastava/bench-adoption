/** Converts database rows into the shapes defined by the API contract. */
import {
  daysBetween,
  todayIn,
  type AdminAdoption,
  type Adoption,
  type BenchSummary,
  type PublicAdoption,
} from '@bench/shared';
import type { AdoptionView } from '../repositories/adoptions.ts';
import type { AdoptionRow, BenchWithCurrentAdoption } from '../repositories/benches.ts';

export const ANONYMOUS_NAME = 'Anonymous donor';

export function toPublicAdoption(a: AdoptionRow): PublicAdoption {
  return {
    displayName: a.isAnonymous ? ANONYMOUS_NAME : a.displayName,
    dedication: a.dedication,
    startDate: a.startDate,
    endDate: a.endDate,
  };
}

export function toBenchSummary(row: BenchWithCurrentAdoption): BenchSummary {
  const { bench, current } = row;
  return {
    id: bench.id,
    code: bench.code,
    name: bench.name,
    zone: row.areaName,
    lat: bench.lat,
    lng: bench.lng,
    status: bench.status,
    availability: row.availability,
    trails: row.trailSlugs,
    currentAdoption: current ? toPublicAdoption(current) : null,
  };
}

export function toAdoption(v: AdoptionView, now: Date): Adoption {
  const a = v.adoption;
  const today = todayIn(v.parkTimezone, now);
  return {
    id: a.id,
    benchId: a.benchId,
    parkSlug: v.parkSlug,
    benchCode: v.benchCode,
    benchName: v.benchName,
    displayName: a.displayName,
    dedication: a.dedication,
    isAnonymous: a.isAnonymous,
    startDate: a.startDate,
    endDate: a.endDate,
    status: a.status,
    renewedFromId: a.renewedFromId,
    isRenewed: v.isRenewed,
    daysRemaining: Math.max(0, daysBetween(today, a.endDate)),
  };
}

export function toAdminAdoption(v: AdoptionView, now: Date): AdminAdoption {
  return { ...toAdoption(v, now), adopterEmail: v.adopterEmail, adopterName: v.adopterName };
}
