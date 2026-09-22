/**
 * Who gets told about what. One exhaustive mapping from events to emails:
 * adding an event type without deciding its notifications is a type error,
 * which is how "we forgot to tell the donor" bugs are prevented.
 */
import type { Config } from '../config.ts';
import type { EmailMessage } from '../email/mailer.ts';
import {
  adoptionConfirmedEmail,
  adoptionEndedEmail,
  adoptionMovedEmail,
  benchRetiredKeptEmail,
  magicLinkEmail,
  renewalReminderEmail,
} from '../email/templates.ts';
import type { DomainEvent } from './events.ts';

export function notificationsFor(event: DomainEvent, config: Config): EmailMessage[] {
  const manageUrl = `${config.webUrl}/me/benches`;

  switch (event.type) {
    case 'adoption.created':
    case 'adoption.renewed': {
      const p = event.payload;
      return [
        adoptionConfirmedEmail(p.email, { ...p, manageUrl, renewal: event.type === 'adoption.renewed' }),
      ];
    }

    case 'adoption.cancelled': {
      const p = event.payload;
      return [adoptionEndedEmail(p.email, { benchCode: p.benchCode, reason: p.reason, manageUrl })];
    }

    case 'adoption.moved': {
      const p = event.payload;
      return [adoptionMovedEmail(p.email, { ...p, manageUrl })];
    }

    case 'adoption.ending_soon': {
      const p = event.payload;
      return [
        renewalReminderEmail(p.email, {
          ...p,
          manageUrl: `${config.webUrl}/me/benches?renew=${p.adoptionId}`,
        }),
      ];
    }

    case 'bench.retired': {
      const kept = event.payload.kept;
      // Only the "keep the adoption running" outcome needs its own note; the
      // other outcomes are announced by adoption.cancelled / adoption.moved.
      return kept
        ? [benchRetiredKeptEmail(kept.email, { ...kept, reason: event.payload.reason, manageUrl })]
        : [];
    }

    // Nobody is notified: restoring a bench changes nothing for donors.
    case 'bench.restored':
      return [];

    case 'signin.requested':
      return [magicLinkEmail(event.payload.email, event.payload)];
  }
}
