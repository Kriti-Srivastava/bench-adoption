import type { EmailMessage } from '../email/mailer.ts';
import type { AppContext } from './context.ts';

/**
 * Sends an email that follows an action which has already succeeded (e.g. a
 * confirmation). A mail outage must not undo or fail the adoption itself,
 * so failures are logged rather than thrown.
 */
export async function notify(ctx: AppContext, message: EmailMessage): Promise<void> {
  try {
    await ctx.mailer.send(message);
  } catch (err) {
    ctx.log.error({ err, to: message.to, subject: message.subject }, 'email failed');
  }
}
