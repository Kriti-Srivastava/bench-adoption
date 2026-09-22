import { runMigrations } from '../db/migrate.ts';
import { runScript } from './run.ts';

await runScript(async (_services, { db }) => {
  await runMigrations(db);
  console.log('Migrations applied.');
});
