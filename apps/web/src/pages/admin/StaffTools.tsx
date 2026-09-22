import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CreateBenchInput } from '@bench/shared';
import { api } from '../../api.ts';
import { ErrorNotice, Loadable } from '../../components/ui.tsx';
import { daysLeftLabel, formatPeriod } from '../../format.ts';
import { keys } from '../../queries.ts';

/** Existing staff tools, shown as tabs of the admin area. */

const WINDOWS = [
  { label: 'Ending in 30 days', days: 30 },
  { label: 'Ending in 90 days', days: 90 },
  { label: 'All current', days: undefined },
];

export function AdoptionsTab({ slug }: { slug: string }) {
  const [windowDays, setWindowDays] = useState<number | undefined>(30);
  const q = { expiringWithinDays: windowDays };
  const adoptions = useQuery({
    queryKey: keys.staffAdoptions(slug, q),
    queryFn: () => api.staff.adoptions(slug, q),
  });
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: api.staff.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.admin });
      queryClient.invalidateQueries({ queryKey: keys.benches(slug) });
    },
  });

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="segmented" role="group" aria-label="Which adoptions">
          {WINDOWS.map((w) => (
            <button key={w.label} aria-pressed={windowDays === w.days} onClick={() => setWindowDays(w.days)}>
              {w.label}
            </button>
          ))}
        </div>
        <a className="btn secondary small" href={api.staff.adoptionsCsvUrl(slug, q)}>
          Download CSV
        </a>
      </div>
      <ErrorNotice error={cancel.error} />
      <Loadable query={adoptions}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted">No adoptions in this range.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bench</th>
                    <th>Adopter</th>
                    <th>Shown as</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/parks/${slug}/benches/${a.benchCode}`}>{a.benchCode}</Link>
                      </td>
                      <td>
                        {a.adopterName ?? '—'}
                        <br />
                        <a className="small" href={`mailto:${a.adopterEmail}`}>
                          {a.adopterEmail}
                        </a>
                      </td>
                      <td>{a.isAnonymous ? `${a.displayName} (anonymous)` : a.displayName}</td>
                      <td>{formatPeriod(a.startDate, a.endDate)}</td>
                      <td>{a.isRenewed ? 'Renewed' : daysLeftLabel(a.daysRemaining)}</td>
                      <td>
                        <button
                          className="btn danger small"
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (confirm(`Cancel the adoption of bench ${a.benchCode}? The bench becomes available.`)) {
                              cancel.mutate(a.id);
                            }
                          }}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </section>
  );
}

export function ImportTab({ slug }: { slug: string }) {
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: async () => api.staff.importCsv(slug, await file!.text()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.benches(slug) });
      queryClient.invalidateQueries({ queryKey: keys.park(slug) });
      queryClient.invalidateQueries({ queryKey: keys.admin });
    },
  });

  return (
    <section className="card stack">
      <p>
        Upload a CSV with the columns <code>code,name,zone,lat,lng</code> and an optional{' '}
        <code>description</code>. Benches whose code already exists are updated, so you can
        re-upload the same spreadsheet after editing it.
      </p>
      <div>
        <label htmlFor="csv">CSV file</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <ErrorNotice error={upload.error} />
      {upload.data && (
        <p className="notice success">
          Imported: {upload.data.created} new, {upload.data.updated} updated.
        </p>
      )}
      <div>
        <button className="btn" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? 'Importing…' : 'Import'}
        </button>
      </div>
    </section>
  );
}

const EMPTY_BENCH = { code: '', name: '', zone: '', lat: '', lng: '', description: '' };

export function AddBenchTab({ slug }: { slug: string }) {
  const [form, setForm] = useState(EMPTY_BENCH);
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: CreateBenchInput) => api.staff.createBench(slug, input),
    onSuccess: () => {
      setForm(EMPTY_BENCH);
      queryClient.invalidateQueries({ queryKey: keys.benches(slug) });
      queryClient.invalidateQueries({ queryKey: keys.park(slug) });
      queryClient.invalidateQueries({ queryKey: keys.admin });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      code: form.code,
      name: form.name,
      zone: form.zone,
      lat: Number(form.lat),
      lng: Number(form.lng),
      description: form.description || null,
    });
  };

  const field = (key: keyof typeof EMPTY_BENCH, label: string, type = 'text') => (
    <div>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        required={key !== 'description'}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="form-grid">
        {field('code', 'Plaque code')}
        {field('name', 'Name')}
        {field('zone', 'Area')}
        {field('description', 'Description (optional)')}
        {field('lat', 'Latitude', 'number')}
        {field('lng', 'Longitude', 'number')}
      </div>
      <ErrorNotice error={create.error} />
      {create.data && (
        <p className="notice success">
          Added <Link to={`/parks/${slug}/benches/${create.data.code}`}>bench {create.data.code}</Link>.
        </p>
      )}
      <div>
        <button className="btn" disabled={create.isPending}>
          Add bench
        </button>
      </div>
    </form>
  );
}
