import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Swap implementations (SMTP, Resend, SES...) without touching services. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
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
