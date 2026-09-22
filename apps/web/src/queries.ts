/** Server state, cached and shared across pages by TanStack Query. */
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export const keys = {
  park: (slug: string) => ['park', slug] as const,
  benches: (slug: string) => ['benches', slug] as const,
  bench: (slug: string, code: string) => ['bench', slug, code] as const,
  me: ['me'] as const,
  myAdoptions: ['my-adoptions'] as const,
  staffAdoptions: (slug: string, q: object) => ['staff-adoptions', slug, q] as const,
};

export const usePark = (slug: string) =>
  useQuery({ queryKey: keys.park(slug), queryFn: () => api.park(slug) });

export const useBenches = (slug: string) =>
  useQuery({ queryKey: keys.benches(slug), queryFn: () => api.allBenches(slug) });

export const useBench = (slug: string, code: string) =>
  useQuery({ queryKey: keys.bench(slug, code), queryFn: () => api.bench(slug, code) });

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 60_000 });

export const useMyAdoptions = (enabled: boolean) =>
  useQuery({ queryKey: keys.myAdoptions, queryFn: api.myAdoptions, enabled });
