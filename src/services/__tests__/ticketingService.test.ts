import {
  assignTicket,
  createTicketFromEvent,
  linkTicketResolutionToSubscription,
  syncTicketToExternalSystem,
} from '../ticketingService';

describe('ticketingService', () => {
  it('creates prioritized tickets from subscription events', () => {
    const ticket = createTicketFromEvent({
      subscriptionId: 'sub-1',
      issueType: 'dispute',
      message: 'Customer disputed the latest charge.',
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(ticket.priority).toBe('urgent');
    expect(ticket.status).toBe('open');
    expect(ticket.subscriptionId).toBe('sub-1');
  });

  it('assigns, syncs, and resolves tickets', () => {
    const ticket = createTicketFromEvent({
      subscriptionId: 'sub-1',
      issueType: 'failed_charge',
      message: 'Payment failed.',
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
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
  });
});
