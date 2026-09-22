import { createAdminService } from './admin.ts';
import { createAdoptionService } from './adoptions.ts';
import { createAuthService } from './auth.ts';
import { createBenchService } from './benches.ts';
import type { AppContext } from './context.ts';
import { createMaintenanceService } from './maintenance.ts';
import { createReminderService } from './reminders.ts';

export function createServices(ctx: AppContext) {
  return {
    auth: createAuthService(ctx),
    benches: createBenchService(ctx),
    adoptions: createAdoptionService(ctx),
    reminders: createReminderService(ctx),
    maintenance: createMaintenanceService(ctx),
    admin: createAdminService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;
