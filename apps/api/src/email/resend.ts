/**
 * Sends through Resend's HTTP API, which suits hosts that block outbound
 * SMTP. Failures throw, so the outbox retries them like any other failure.
 */
import type { EmailMessage, Mailer } from './mailer.ts';

export function createResendMailer(opts: { apiKey: string; from: string }): Mailer {
  return {
    async send(message: EmailMessage) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: opts.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend refused the message (${res.status}): ${await res.text()}`);
      }
    },
  };
}
