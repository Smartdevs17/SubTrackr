import { act } from 'react';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { useSupportStore } from '../supportStore';

describe('supportStore', () => {
  beforeEach(() => {
    useSupportStore.setState({
      tickets: [],
      integration: {
        provider: 'internal',
        enabled: true,
        defaultAssignee: 'support-team',
        baseUrl: 'https://support.local',
        queueName: 'billing-support',
      },
    });
  });

  it('dedupes open support tickets for the same subscription issue', () => {
    const baseEvent = {
      subscriptionId: 'sub-1',
      issueType: 'failed_charge' as const,
      message: 'Payment failed.',
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
      context: {
        subscriptionName: 'Pro Plan',
        planName: 'Pro Plan',
        planTier: 'premium',
        billingCycle: 'monthly',
        status: 'active',
        amount: 49,
        currency: 'USD',
        createdAt: '2026-04-01T00:00:00.000Z',
        nextBillingDate: '2026-06-01T00:00:00.000Z',
        failedPayments: 1,
        chargeCount: 3,
        history: ['Retry failed once'],
      },
    };

    act(() => {
      useSupportStore.getState().createTicket(baseEvent);
      useSupportStore.getState().createTicket({
        ...baseEvent,
        message: 'Duplicate failure event.',
      });
    });

    const { tickets } = useSupportStore.getState();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].auditTrail.some((entry) => entry.action === 'dedupe')).toBe(true);
    expect(tickets[0].supportContext.history).toContain('Duplicate failure event.');
  });

  it('records support actions and survey responses', () => {
    act(() => {
      useSupportStore.getState().createTicket({
        subscriptionId: 'sub-2',
        issueType: 'cancellation',
        message: 'Cancellation needs retention review.',
        occurredAt: new Date('2026-05-02T00:00:00.000Z'),
        context: {
          subscriptionName: 'Team Plan',
          planName: 'Team Plan',
          planTier: 'enterprise',
          billingCycle: 'yearly',
          status: 'cancel_pending',
          amount: 129,
          currency: 'USD',
          createdAt: '2026-01-01T00:00:00.000Z',
          nextBillingDate: '2026-06-01T00:00:00.000Z',
          failedPayments: 0,
          chargeCount: 1,
          history: ['Cancellation requested'],
        },
      });
      useSupportStore
        .getState()
        .performSupportAction('ticket-does-not-exist', 'cancel', 'agent-1', 'noop');
    });

    const ticketId = useSupportStore.getState().tickets[0].id;
    act(() => {
      useSupportStore
        .getState()
        .performSupportAction(ticketId, 'pause', 'agent-1', 'Paused for investigation');
      useSupportStore.getState().submitSurvey(ticketId, 5, 'Great resolution');
    });

    const ticket = useSupportStore.getState().tickets[0];
    expect(ticket.actions).toHaveLength(1);
    expect(ticket.status).toBe('resolved');
    expect(ticket.survey.status).toBe('completed');
    expect(ticket.survey.rating).toBe(5);
  });
});
