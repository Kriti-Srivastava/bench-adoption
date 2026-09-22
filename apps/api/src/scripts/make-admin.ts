// Usage: npm run make-admin -- someone@example.org
import { email } from '@bench/shared';
import { runScript } from './run.ts';

await runScript(async (services) => {
  const address = email.parse(process.argv[2]);
  const user = await services.auth.setRole(address, 'admin');
  console.log(`${user.email} is now an admin. They can sign in with a magic link.`);
});
