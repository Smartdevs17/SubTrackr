import {
  assignTicket,
  buildSupportEventMessage,
  createTicketFromEvent,
  linkTicketResolutionToSubscription,
  recordSupportSurvey,
  syncTicketToExternalSystem,
} from '../ticketingService';

describe('ticketingService', () => {
  it('creates prioritized tickets from subscription events', () => {
    const ticket = createTicketFromEvent({
      subscriptionId: 'sub-1',
      issueType: 'dispute',
      message: 'Customer disputed the latest charge.',
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
        failedPayments: 0,
        chargeCount: 2,
        history: ['Charged successfully on the last cycle'],
      },
    });

    expect(ticket.priority).toBe('urgent');
    expect(ticket.status).toBe('open');
    expect(ticket.subscriptionId).toBe('sub-1');
    expect(ticket.sla.status).toBe('on_track');
    expect(ticket.auditTrail).toHaveLength(1);
  });

  it('assigns, syncs, and resolves tickets', () => {
    const ticket = createTicketFromEvent({
      subscriptionId: 'sub-1',
      issueType: 'failed_charge',
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
        failedPayments: 2,
        chargeCount: 4,
        history: ['Card failed twice today'],
      },
    });
    const assigned = assignTicket(ticket, 'agent-1');
    const synced = syncTicketToExternalSystem(assigned, {
      provider: 'zendesk',
      enabled: true,
      defaultAssignee: 'support',
    });
    const resolved = linkTicketResolutionToSubscription(synced, 'sub-1');

    expect(assigned.status).toBe('assigned');
    expect(synced.externalSystem).toBe('zendesk');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionSubscriptionId).toBe('sub-1');
    expect(recordSupportSurvey(resolved, 5, 'Great help').survey.status).toBe('completed');
  });

  it('builds support messages from context', () => {
    expect(
      buildSupportEventMessage(
        {
          subscriptionName: 'Acme Pro',
          planName: 'Acme Pro',
          planTier: 'premium',
          billingCycle: 'monthly',
          status: 'active',
          amount: 99,
          currency: 'USD',
          createdAt: '2026-04-01T00:00:00.000Z',
          failedPayments: 1,
          chargeCount: 3,
          history: ['Failed payment recorded'],
        },
        'failed_charge'
      )
    ).toContain('payment failed');
  });
});
