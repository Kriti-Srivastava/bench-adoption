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

export const adoptionMovedEmail: Template<{
  fromCode: string;
  toCode: string;
  toName: string;
  endDate: string;
  reason: string | null;
  manageUrl: string;
}> = (to, d) => ({
  to,
  subject: `Your adoption has moved to bench ${d.toCode}`,
  text:
    `Bench ${d.fromCode} is being removed from the park` +
    (d.reason ? ` (${d.reason})` : '') +
    `, so we've moved your adoption and dedication to bench ${d.toCode} (${d.toName}).\n\n` +
    `Your adoption continues unchanged until ${longDate(d.endDate)}. ` +
    `Our crew will move your plaque to the new bench.\n\n` +
    `See your benches here:\n${d.manageUrl}` +
    signature,
});

/** A cancellation: by staff, or because the bench was retired (then `reason` explains). */
export const adoptionEndedEmail: Template<{
  benchCode: string;
  reason: string | null;
  manageUrl: string;
}> = (to, d) => ({
  to,
  subject: `Your adoption of bench ${d.benchCode} has ended`,
  text:
    (d.reason
      ? `Bench ${d.benchCode} has been removed from the park (${d.reason}), so your adoption of it has ended early.`
      : `Your adoption of bench ${d.benchCode} has been ended by the park team.`) +
    `

We're sorry for the change. If you'd like to adopt another bench, ` +
    `just reply to this email and we'll help you choose one, or browse the map:
${d.manageUrl}` +
    signature,
});

export const benchRetiredKeptEmail: Template<{
  benchCode: string;
  endDate: string;
  reason: string | null;
  manageUrl: string;
}> = (to, d) => ({
  to,
  subject: `Bench ${d.benchCode} is leaving the park`,
  text:
    `Bench ${d.benchCode} is being retired from the adoption program` +
    (d.reason ? ` (${d.reason})` : '') +
    `.\n\n` +
    `Your dedication stays on it until ${longDate(d.endDate)}, as agreed. ` +
    `After that the bench will be removed, so this adoption can't be renewed. ` +
    `We'd be glad to help you choose another bench nearer the time:\n${d.manageUrl}` +
    signature,
});
