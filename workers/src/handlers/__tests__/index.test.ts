/**
 * workers/src/handlers/__tests__/index.test.ts
 *
 * Unit tests for the default worker lifecycle handlers (issue #2258). Tests
 * registration, dispatch through the shared bus, typed payload handling and
 * handler isolation using only in-memory sinks.
 */

import { createEventBus, DomainEventType, type DomainEvent } from '../../../../backend/src/events/bus';
import {
  createHandlerContext,
  handleSubscriptionCreated,
  handleInvoicePaid,
  registerDefaultHandlers,
  type WorkerHandlerContext,
} from '../index';

/** Build a typed event for tests. */
function makeEvent(
  type: DomainEventType,
  payload: Record<string, unknown>,
  id: string = 'evt-1'
): DomainEvent {
  return {
    id,
    type,
    occurredAt: '2026-01-01T00:00:00.000Z',
    aggregateId: id,
    payload,
  } as DomainEvent;
}

describe('createHandlerContext', () => {
  it('starts with empty, independent sinks', () => {
    const a = createHandlerContext();
    const b = createHandlerContext();
    expect(a.emailsSent).toHaveLength(0);
    expect(a.ledgerEntries).toHaveLength(0);
    expect(a.audit).toHaveLength(0);
    a.emailsSent.push({ to: 'x', template: 'y', data: {} });
    expect(b.emailsSent).toHaveLength(0);
  });
});

describe('individual handlers', () => {
  it('queues a welcome email for a created subscription', () => {
    const context = createHandlerContext();
    handleSubscriptionCreated(
      makeEvent(DomainEventType.SUBSCRIPTION_CREATED, {
        subscriptionId: 'sub-1',
        userId: 'user-1',
        planId: 'pro',
        email: 'user@example.com',
      }) as never,
      context
    );
    expect(context.emailsSent).toHaveLength(1);
    expect(context.emailsSent[0]?.to).toBe('user@example.com');
    expect(context.emailsSent[0]?.template).toBe('subscription-welcome');
    expect(context.audit).toHaveLength(1);
    expect(context.audit[0]?.type).toBe('subscription.created');
  });

  it('records a ledger credit for a paid invoice', () => {
    const context = createHandlerContext();
    handleInvoicePaid(
      makeEvent(DomainEventType.INVOICE_PAID, {
        invoiceId: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        amountCents: 1299,
        currency: 'USD',
      }) as never,
      context
    );
    expect(context.ledgerEntries).toHaveLength(1);
    expect(context.ledgerEntries[0]?.kind).toBe('credit');
    expect(context.ledgerEntries[0]?.amountCents).toBe(1299);
    expect(context.audit[0]?.detail).toContain('inv-1');
  });
});

describe('registerDefaultHandlers', () => {
  it('registers one handler for every lifecycle event type', () => {
    const bus = createEventBus();
    const { context, registrations } = registerDefaultHandlers(bus);
    expect(registrations).toHaveLength(5);
    expect(bus.handlers()).toHaveLength(5);
    expect(context.emailsSent).toHaveLength(0);
    expect(context.ledgerEntries).toHaveLength(0);
    expect(context.audit).toHaveLength(0);
  });

  it('dispatches a subscription.created event to the welcome-email handler', async () => {
    const bus = createEventBus();
    const { context } = registerDefaultHandlers(bus);
    const result = await bus.publish(
      makeEvent(DomainEventType.SUBSCRIPTION_CREATED, {
        subscriptionId: 'sub-2',
        userId: 'user-2',
        planId: 'starter',
        email: 'new@example.com',
        householdId: 'house-1',
      })
    );
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(context.emailsSent).toHaveLength(1);
    expect(context.emailsSent[0]?.data).toEqual({
      subscriptionId: 'sub-2',
      planId: 'starter',
      userId: 'user-2',
      householdId: 'house-1',
    });
    expect(context.audit).toHaveLength(1);
  });

  it('dispatches an invoice.paid event to the ledger handler', async () => {
    const bus = createEventBus();
    const { context } = registerDefaultHandlers(bus);
    await bus.publish(
      makeEvent(DomainEventType.INVOICE_PAID, {
        invoiceId: 'inv-9',
        subscriptionId: 'sub-9',
        userId: 'user-9',
        amountCents: 2500,
        currency: 'EUR',
      })
    );
    expect(context.ledgerEntries).toHaveLength(1);
    expect(context.ledgerEntries[0]?.invoiceId).toBe('inv-9');
    expect(context.ledgerEntries[0]?.currency).toBe('EUR');
  });

  it('handles the remaining lifecycle events through the shared bus', async () => {
    const bus = createEventBus();
    const { context } = registerDefaultHandlers(bus);
    await bus.publish(
      makeEvent(DomainEventType.SUBSCRIPTION_CANCELLED, {
        subscriptionId: 'sub-3',
        userId: 'user-3',
        reason: 'too expensive',
      })
    );
    await bus.publish(
      makeEvent(DomainEventType.HOUSEHOLD_INVITE_ACCEPTED, {
        householdId: 'house-1',
        userId: 'user-4',
        invitedByUserId: 'user-2',
      })
    );
    await bus.publish(
      makeEvent(DomainEventType.PAYMENT_FAILED, {
        paymentId: 'pay-1',
        invoiceId: 'inv-1',
        userId: 'user-1',
        reason: 'card declined',
      })
    );
    expect(context.audit).toHaveLength(3);
    expect(context.audit[0]?.detail).toContain('too expensive');
    expect(context.audit[1]?.detail).toContain('house-1');
    expect(context.audit[2]?.detail).toContain('card declined');
  });

  it('supports an injected context and unregistering handlers', async () => {
    const bus = createEventBus();
    const context: WorkerHandlerContext = createHandlerContext();
    const { registrations } = registerDefaultHandlers(bus, context);
    expect(registrations[1]?.unsubscribe()).toBe(true);
    expect(bus.handlers()).toHaveLength(4);
    await bus.publish(
      makeEvent(DomainEventType.SUBSCRIPTION_CANCELLED, {
        subscriptionId: 'sub-4',
        userId: 'user-4',
      })
    );
    expect(context.audit).toHaveLength(0);
  });
});
