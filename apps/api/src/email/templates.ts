import type { EmailMessage } from './mailer.ts';

type Template<T> = (to: string, data: T) => EmailMessage;

const signature = '\n\nThank you for supporting Van Cortlandt Park.\n';

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });

export const magicLinkEmail: Template<{ link: string; ttlMinutes: number }> = (to, d) => ({
  to,
  subject: 'Your sign-in link',
  text:
    `Click the link below to sign in to the bench adoption program:\n\n${d.link}\n\n` +
    `This link works once and expires in ${d.ttlMinutes} minutes. ` +
    `If you didn't request it, you can ignore this email.`,
});

interface AdoptionEmailData {
  benchCode: string;
  benchName: string;
  startDate: string;
  endDate: string;
  manageUrl: string;
}

export const adoptionConfirmedEmail: Template<AdoptionEmailData & { renewal: boolean }> = (
  to,
  d,
) => ({
  to,
  subject: d.renewal
    ? `Renewal confirmed: bench ${d.benchCode}`
    : `You've adopted bench ${d.benchCode}`,
  text:
    `${d.renewal ? 'Your renewal is confirmed' : 'Your adoption is confirmed'} for ` +
    `bench ${d.benchCode} (${d.benchName}).\n\n` +
    `Adoption period: ${longDate(d.startDate)} until ${longDate(d.endDate)}.\n\n` +
    `We'll email you before it ends so you can renew. You can view or renew ` +
    `your benches at any time here:\n${d.manageUrl}` +
    signature,
});

export const renewalReminderEmail: Template<AdoptionEmailData & { daysLeft: number }> = (
  to,
  d,
) => ({
  to,
  subject: `Bench ${d.benchCode}: your adoption ends in ${d.daysLeft} days`,
  text:
    `Your adoption of bench ${d.benchCode} (${d.benchName}) ends on ` +
    `${longDate(d.endDate)}.\n\n` +
    `Renew now to keep your dedication in place. It takes one click:\n${d.manageUrl}\n\n` +
    `If you don't renew, the bench becomes available to other donors after it ends.` +
    signature,
});
