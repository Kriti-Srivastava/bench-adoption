/**
 * Typed client for the bench adoption API. Request and response types come
 * from @bench/shared, so a contract change breaks the build here too.
 */
import type {
  AdminAdoption,
  AdminBench,
  AdminSummary,
  AdminUser,
  CreateTaskInput,
  MaintenanceQuery,
  MaintenanceTask,
  ReportProblemInput,
  RetireBenchInput,
  Role,
  UpdateTaskInput,
  UserReport,
  Adoption,
  BenchDetail,
  BenchList,
  BenchSummary,
  CreateAdoptionInput,
  CreateBenchInput,
  ErrorResponse,
  ImportBenchesResult,
  ListBenchesQuery,
  Me,
  Park,
  UpdateBenchInput,
} from '@bench/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ErrorResponse | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText);
  }
  return data as T;
}

const query = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const api = {
  park: (slug: string) => request<Park>(`/parks/${slug}`),

  benches: (slug: string, q: ListBenchesQuery = {}) =>
    request<BenchList>(`/parks/${slug}/benches${query({ ...q })}`),

  /** Every active bench in the park, following pagination to the end. */
  async allBenches(slug: string): Promise<BenchSummary[]> {
    const items: BenchSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.benches(slug, { limit: 1000, cursor });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  bench: (slug: string, code: string) =>
    request<BenchDetail>(`/parks/${slug}/benches/${encodeURIComponent(code)}`),

  /** The signed-in user, or null when signed out. */
  async me(): Promise<Me | null> {
    try {
      return await request<Me>('/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  updateMe: (fullName: string) => request<Me>('/me', { method: 'PATCH', body: { fullName } }),
  requestMagicLink: (email: string, redirectTo?: string) =>
    request<void>('/auth/magic-link', { method: 'POST', body: { email, redirectTo } }),
  verifyMagicLink: (token: string) =>
    request<{ user: Me; redirectTo: string | null }>('/auth/verify', { method: 'POST', body: { token } }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  adopt: (input: CreateAdoptionInput) =>
    request<Adoption>('/adoptions', { method: 'POST', body: input }),
  renew: (id: string, months: number) =>
    request<Adoption>(`/adoptions/${id}/renew`, { method: 'POST', body: { months } }),
  myAdoptions: () => request<{ items: Adoption[] }>('/me/adoptions').then((r) => r.items),

  reportProblem: (benchId: string, input: ReportProblemInput) =>
    request<UserReport>(`/benches/${benchId}/reports`, { method: 'POST', body: input }),
  myReports: () => request<{ items: UserReport[] }>('/me/reports').then((r) => r.items),

  staff: {
    summary: (slug: string) => request<AdminSummary>(`/parks/${slug}/admin/summary`),
    benches: (slug: string) =>
      request<{ items: AdminBench[] }>(`/parks/${slug}/admin/benches`).then((r) => r.items),
    retire: (benchId: string, input: RetireBenchInput) =>
      request<BenchSummary>(`/benches/${benchId}/retire`, { method: 'POST', body: input }),
    restore: (benchId: string) => request<BenchSummary>(`/benches/${benchId}/restore`, { method: 'POST' }),
    tasks: (slug: string, q: MaintenanceQuery = {}) =>
      request<{ items: MaintenanceTask[] }>(`/parks/${slug}/maintenance${query({ ...q })}`).then((r) => r.items),
    benchTasks: (benchId: string) =>
      request<{ items: MaintenanceTask[] }>(`/benches/${benchId}/maintenance`).then((r) => r.items),
    createTask: (benchId: string, input: CreateTaskInput) =>
      request<MaintenanceTask>(`/benches/${benchId}/maintenance`, { method: 'POST', body: input }),
    updateTask: (id: string, input: UpdateTaskInput) =>
      request<MaintenanceTask>(`/maintenance/${id}`, { method: 'PATCH', body: input }),
    users: (q: { q?: string; role?: Role } = {}) =>
      request<{ items: AdminUser[] }>(`/admin/users${query(q)}`).then((r) => r.items),
    setRole: (email: string, role: Role) =>
      request<Me>('/users/role', { method: 'PUT', body: { email, role } }),
    adoptions: (slug: string, q: { expiringWithinDays?: number; includeEnded?: boolean }) =>
      request<{ items: AdminAdoption[] }>(`/parks/${slug}/adoptions${query(q)}`).then((r) => r.items),
    adoptionsCsvUrl: (slug: string, q: { expiringWithinDays?: number; includeEnded?: boolean }) =>
      `${BASE}/parks/${slug}/adoptions.csv${query(q)}`,
    cancel: (id: string) => request<Adoption>(`/adoptions/${id}/cancel`, { method: 'POST' }),
    createBench: (slug: string, input: CreateBenchInput) =>
      request<BenchSummary>(`/parks/${slug}/benches`, { method: 'POST', body: input }),
    updateBench: (id: string, input: UpdateBenchInput) =>
      request<BenchSummary>(`/benches/${id}`, { method: 'PATCH', body: input }),
    importCsv: (slug: string, csv: string) =>
      request<ImportBenchesResult>(`/parks/${slug}/benches/import`, { method: 'POST', body: { csv } }),
  },
};
