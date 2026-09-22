import type { MaintenancePriority, MaintenanceStatus, MaintenanceType } from '@bench/shared';

export const TYPE_LABEL: Record<MaintenanceType, string> = {
  inspection: 'Inspection',
  repair: 'Repair',
  painting: 'Painting',
  cleaning: 'Cleaning',
  graffiti: 'Graffiti',
  plaque: 'Plaque',
  relocation: 'Relocation',
  other: 'Other',
};

export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  urgent: 'Urgent',
  normal: 'Normal',
  low: 'Low',
};

export const isOpen = (s: MaintenanceStatus) => s === 'open' || s === 'scheduled' || s === 'in_progress';
