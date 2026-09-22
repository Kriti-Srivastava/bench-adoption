/**
 * Domain events: the record of what happened, written in the same
 * transaction as the change itself.
 *
 * Recording an event also queues the notifications it calls for (see
 * notifications.ts), so a confirmation email can never be lost because mail
 * was down, nor sent for a change that was rolled back.
 */
import type { EventType } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import * as eventRepo from '../repositories/events.ts';
import type { AppContext } from './context.ts';
import { notificationsFor } from './notifications.ts';

interface AdoptionMail {
  email: string;
  benchCode: string;
  benchName: string;
  startDate: string;
  endDate: string;
}

/**
 * Every kind of event, with everything needed to render its notifications
 * captured at the moment it happened (so later edits can't rewrite history).
 */
export type DomainEvent =
  | { type: 'adoption.created'; payload: AdoptionMail }
  | { type: 'adoption.renewed'; payload: AdoptionMail }
  | { type: 'adoption.cancelled'; payload: { email: string; benchCode: string; reason: string | null } }
  | {
      type: 'adoption.moved';
      payload: {
        email: string;
        fromCode: string;
        toCode: string;
        toName: string;
        endDate: string;
        reason: string | null;
      };
    }
  | { type: 'adoption.ending_soon'; payload: AdoptionMail & { daysLeft: number; adoptionId: string } }
  | {
      type: 'bench.retired';
      payload: {
        code: string;
        reason: string | null;
        outcome: 'keep' | 'end' | 'relocate' | 'none';
        /** Present when the adoption keeps running on the retired bench. */
        kept: { email: string; benchCode: string; endDate: string } | null;
      };
    }
  | { type: 'bench.restored'; payload: { code: string } }
  | {
      type: 'signin.requested';
      payload: { email: string; link: string; ttlMinutes: number; audience: 'donor' | 'staff' };
    }
  /** Someone asked for a staff link with an address that has no staff access. */
  | { type: 'signin.refused'; payload: { email: string } };

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;

export interface EventContext {
  benchId?: string;
  adoptionId?: string;
  actorId?: string;
}

/**
 * Appends an event and queues its notifications. Always called with the
 * transaction that performs the change.
 */
export async function recordEvent(
  tx: Executor,
  ctx: AppContext,
  event: DomainEvent,
  context: EventContext = {},
): Promise<void> {
  const row = await eventRepo.insertEvent(tx, {
    type: event.type,
    payload: event.payload,
    benchId: context.benchId ?? null,
    adoptionId: context.adoptionId ?? null,
    actorId: context.actorId ?? null,
  });
  const messages = notificationsFor(event, ctx.config);
  if (messages.length > 0) {
    await eventRepo.enqueueEmails(
      tx,
      messages.map((m) => ({
        eventId: row.id,
        recipient: m.to,
        subject: m.subject,
        body: m.text,
        // Stamped from the application clock: the worker compares against the
        // same clock, and database defaults (now()) would not match it.
        nextAttemptAt: ctx.clock.now(),
      })),
    );
  }
}
