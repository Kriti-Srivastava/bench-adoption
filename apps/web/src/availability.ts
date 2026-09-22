import { benchAvailabilities, type BenchAvailability } from '@bench/shared';

/** How each bench state looks everywhere in the app: map pins, badges, legend. */
export const AVAILABILITY: Record<BenchAvailability, { label: string; color: string }> = {
  available: { label: 'Available', color: '#2e9e5b' },
  adopted: { label: 'Adopted', color: '#d64541' },
  ending_soon: { label: 'Ending soon', color: '#e0a100' },
  retired: { label: 'Retired', color: '#8b918d' },
};

export const ALL_AVAILABILITIES = benchAvailabilities;
