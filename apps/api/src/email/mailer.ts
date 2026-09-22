import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';
import { createResendMailer } from './resend.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Swap implementations (SMTP, Resend, SES...) without touching services. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** The mailer this configuration asks for. */
export function createMailer(mail: Config['mail']): Mailer {
  return mail.provider === 'resend'
    ? createResendMailer({ apiKey: mail.apiKey, from: mail.from })
    : createSmtpMailer(mail);
}

export function createSmtpMailer(opts: { host: string; port: number; from: string }): Mailer {
  const transport = nodemailer.createTransport({ host: opts.host, port: opts.port });
  return {
    async send(message) {
      await transport.sendMail({ from: opts.from, ...message });
    },
  };
}

/** Collects messages in memory; used by tests. */
export function createMemoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
