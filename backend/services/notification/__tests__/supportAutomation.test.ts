import {
  buildExternalPayload,
  buildSupportTicket,
  dedupeSupportTickets,
  recordExternalSync,
  recordSupportAction,
} from '../supportAutomation';

describe('supportAutomation', () => {
  const context = {
    subscriptionId: 'sub-1',
    subscriptionName: 'Acme Pro',
    planName: 'Acme Pro',
    planTier: 'premium',
    billingCycle: 'monthly',
    status: 'active',
    amount: 49,
    currency: 'USD',
    createdAt: '2026-05-01T00:00:00.000Z',
    nextBillingDate: '2026-06-01T00:00:00.000Z',
    failedPayments: 1,
    chargeCount: 3,
    history: ['Payment failed twice'],
  };

  it('dedupes open tickets for the same subscription issue', () => {
    const candidate = buildSupportTicket({
      subscriptionId: 'sub-1',
      issueType: 'failed_charge',
      summary: 'Auto-created from failed payment',
      createdAt: '2026-05-01T00:00:00.000Z',
      context,
    });
    const merged = dedupeSupportTickets([candidate], {
      ...candidate,
      id: 'candidate-2',
      description: 'Duplicate failure event',
      version: 1,
      auditTrail: candidate.auditTrail,
      actions: candidate.actions,
      sla: candidate.sla,
      relatedTicketIds: [],
    });

    expect(merged.id).toBe(candidate.id);
    expect(merged.relatedTicketIds).toContain('candidate-2');
  });

  it('records actions, syncs, and builds external payloads', () => {
    const ticket = buildSupportTicket({
      subscriptionId: 'sub-2',
      issueType: 'cancellation',
      summary: 'Cancellation needs review',
      createdAt: '2026-05-02T00:00:00.000Z',
      context: {
        ...context,
        subscriptionId: 'sub-2',
        subscriptionName: 'Northwind Teams',
        planName: 'Team Plan',
        planTier: 'enterprise',
        billingCycle: 'yearly',
      },
    });
    const acted = recordSupportAction(ticket, 'cancel', 'agent-1', 'Cancelled after verification');
    const synced = recordExternalSync(acted, 'zendesk', 'https://support.example.com');
    const payload = buildExternalPayload(synced, 'zendesk');

    expect(acted.status).toBe('resolved');
    expect(synced.externalProvider).toBe('zendesk');
    expect(payload.context.subscriptionName).toBe('Northwind Teams');
    expect(payload.actions).toHaveLength(1);
    expect(payload.sla.resolutionDueAt).toBeTruthy();
  });
});
