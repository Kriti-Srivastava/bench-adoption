import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  maintenancePriorities,
  maintenanceStatuses,
  maintenanceTypes,
  type AdminUser,
  type CreateTaskInput,
  type MaintenancePriority,
  type MaintenanceStatus,
  type MaintenanceTask,
  type MaintenanceType,
} from '@bench/shared';
import { api } from '../api.ts';
import { formatDate } from '../format.ts';
import { isOpen, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../maintenance.ts';
import { keys } from '../queries.ts';
import { ErrorNotice } from './ui.tsx';

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function StatusPill({ status }: { status: MaintenanceStatus }) {
  return <span className={`badge task-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Refreshes every admin view after a change (tasks affect several screens). */
function useRefreshAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.admin });
}

/** One task: a summary line that expands into an editor. */
export function TaskItem({
  task,
  staff,
  showBench,
  parkSlug,
}: {
  task: MaintenanceTask;
  staff: AdminUser[];
  showBench?: boolean;
  parkSlug: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`task ${isOpen(task.status) ? '' : 'task-closed'}`}>
      <button type="button" className="task-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="task-main">
          <span className="task-title">
            {task.title}
            {showBench && <span className="muted"> · {task.benchCode}</span>}
          </span>
          <span className="muted small">
            {TYPE_LABEL[task.type]} · opened {formatDate(task.createdAt.slice(0, 10))}
            {task.scheduledFor && ` · scheduled ${formatDate(task.scheduledFor)}`}
            {task.assignee && ` · ${task.assignee.name ?? task.assignee.email}`}
          </span>
        </span>
        <span className="row" style={{ gap: '0.4rem' }}>
          {task.priority !== 'normal' && <PriorityBadge priority={task.priority} />}
          <StatusPill status={task.status} />
        </span>
      </button>
      {open && <TaskForm task={task} staff={staff} parkSlug={parkSlug} onSaved={() => setOpen(false)} />}
    </li>
  );
}

function TaskForm({
  task,
  staff,
  parkSlug,
  onSaved,
}: {
  task: MaintenanceTask;
  staff: AdminUser[];
  parkSlug: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    status: task.status,
    priority: task.priority,
    assigneeId: task.assignee?.id ?? '',
    scheduledFor: task.scheduledFor ?? '',
    resolution: task.resolution ?? '',
  });
  const refresh = useRefreshAdmin();
  const save = useMutation({
    mutationFn: (changes: Partial<typeof form> = {}) => {
      const f = { ...form, ...changes };
      return api.staff.updateTask(task.id, {
        status: f.status,
        priority: f.priority,
        assigneeId: f.assigneeId || null,
        scheduledFor: f.scheduledFor || null,
        resolution: f.resolution.trim() || null,
      });
    },
    onSuccess: () => {
      refresh();
      onSaved();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({});
  };

  return (
    <form className="task-form stack" onSubmit={submit}>
      {task.details && <p className="small" style={{ margin: 0 }}>{task.details}</p>}
      {task.reportedBy && (
        <p className="muted small" style={{ margin: 0 }}>
          Raised by {task.reportedBy.name ?? task.reportedBy.email}
          {' · '}
          <Link to={`/parks/${parkSlug}/admin/benches/${task.benchCode}`}>bench {task.benchCode}</Link>
        </p>
      )}
      <div className="form-grid">
        <div>
          <label htmlFor={`status-${task.id}`}>Status</label>
          <select
            id={`status-${task.id}`}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as MaintenanceStatus })}
          >
            {maintenanceStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`priority-${task.id}`}>Priority</label>
          <select
            id={`priority-${task.id}`}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as MaintenancePriority })}
          >
            {maintenancePriorities.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`assignee-${task.id}`}>Assigned to</label>
          <select
            id={`assignee-${task.id}`}
            value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
          >
            <option value="">Unassigned</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName ?? u.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`scheduled-${task.id}`}>Scheduled for</label>
          <input
            id={`scheduled-${task.id}`}
            type="date"
            value={form.scheduledFor}
            onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
          />
        </div>
        <div className="full">
          <label htmlFor={`resolution-${task.id}`}>Notes / what was done</label>
          <textarea
            id={`resolution-${task.id}`}
            value={form.resolution}
            maxLength={2000}
            onChange={(e) => setForm({ ...form, resolution: e.target.value })}
          />
        </div>
      </div>
      <ErrorNotice error={save.error} />
      <div className="row">
        <button className="btn small" disabled={save.isPending}>
          Save
        </button>
        {isOpen(task.status) && (
          <button
            type="button"
            className="btn secondary small"
            disabled={save.isPending}
            onClick={() => save.mutate({ status: 'done' })}
          >
            Mark done
          </button>
        )}
      </div>
    </form>
  );
}

/** Raise a new task on a bench. */
export function NewTaskForm({ benchId, onCreated }: { benchId: string; onCreated?: () => void }) {
  const empty = { type: 'repair' as MaintenanceType, priority: 'normal' as MaintenancePriority, title: '', details: '', scheduledFor: '' };
  const [form, setForm] = useState(empty);
  const refresh = useRefreshAdmin();
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.staff.createTask(benchId, input),
    onSuccess: () => {
      setForm(empty);
      refresh();
      onCreated?.();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      type: form.type,
      priority: form.priority,
      title: form.title,
      details: form.details.trim() || null,
      scheduledFor: form.scheduledFor || null,
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <div>
          <label htmlFor="new-type">Type</label>
          <select
            id="new-type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as MaintenanceType })}
          >
            {maintenanceTypes.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="new-priority">Priority</label>
          <select
            id="new-priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as MaintenancePriority })}
          >
            {maintenancePriorities.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="full">
          <label htmlFor="new-title">What needs doing?</label>
          <input
            id="new-title"
            type="text"
            required
            maxLength={120}
            placeholder="e.g. Replace broken slat"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="full">
          <label htmlFor="new-details">Details (optional)</label>
          <textarea
            id="new-details"
            maxLength={2000}
            value={form.details}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="new-scheduled">Schedule for (optional)</label>
          <input
            id="new-scheduled"
            type="date"
            value={form.scheduledFor}
            onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
          />
        </div>
      </div>
      <ErrorNotice error={create.error} />
      <div>
        <button className="btn small" disabled={create.isPending}>
          Add task
        </button>
      </div>
    </form>
  );
}
