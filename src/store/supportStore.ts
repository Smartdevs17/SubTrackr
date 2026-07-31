import { create } from 'zustand';
import {
  applySupportAction,
  assignTicket,
  buildSupportAuditEntry,
  createTicketFromEvent,
  linkTicketResolutionToSubscription,
  recordSupportSurvey,
  syncTicketToExternalSystem,
} from '../services/ticketingService';
import {
  SubscriptionSupportContext,
  SubscriptionSupportEvent,
  SupportActionType,
  SupportTicket,
  TicketingIntegrationConfig,
  TicketStatus,
} from '../types/support';

interface SupportState {
  tickets: SupportTicket[];
  integration: TicketingIntegrationConfig;
  createTicket: (event: SubscriptionSupportEvent) => SupportTicket;
  assignTicket: (ticketId: string, assignee: string) => void;
  updateTicketStatus: (ticketId: string, status: TicketStatus) => void;
  performSupportAction: (
    ticketId: string,
    action: SupportActionType,
    actorId: string,
    note?: string,
    expectedVersion?: number
  ) => void;
  syncTicket: (ticketId: string) => void;
  linkResolution: (ticketId: string, subscriptionId: string) => void;
  submitSurvey: (ticketId: string, rating: number, comment?: string) => void;
  setIntegration: (integration: TicketingIntegrationConfig) => void;
}

const mapTicket = (
  tickets: SupportTicket[],
  ticketId: string,
  updater: (ticket: SupportTicket) => SupportTicket
): SupportTicket[] => tickets.map((ticket) => (ticket.id === ticketId ? updater(ticket) : ticket));

const findDedupeTicket = (
  tickets: SupportTicket[],
  event: SubscriptionSupportEvent
): SupportTicket | undefined => {
  const openStatuses: TicketStatus[] = ['open', 'assigned', 'pending_customer'];
  const dedupeKey = event.dedupeKey;
  return tickets.find((ticket) => {
    if (!openStatuses.includes(ticket.status)) return false;
    if (ticket.subscriptionId !== event.subscriptionId) return false;
    if (ticket.issueType !== event.issueType) return false;
    if (dedupeKey && ticket.dedupeKey !== dedupeKey) return false;
    return true;
  });
};

const enrichContext = (
  context: SubscriptionSupportContext,
  historyEntry: string
): SubscriptionSupportContext => ({
  ...context,
  history: Array.from(new Set([...context.history, historyEntry])),
});

const seedContext = (
  subscriptionName: string,
  planName: string,
  planTier: string,
  status: string,
  amount: number,
  currency: string,
  createdAt: string,
  history: string[],
  billingCycle = 'monthly',
  nextBillingDate?: string
): SubscriptionSupportContext => ({
  subscriptionName,
  planName,
  planTier,
  billingCycle,
  status,
  amount,
  currency,
  createdAt,
  nextBillingDate,
  failedPayments: 0,
  chargeCount: 0,
  history,
});

const seedTickets: SupportTicket[] = [
  createTicketFromEvent({
    subscriptionId: 'sub_support_1',
    issueType: 'failed_charge',
    message: 'Payment failed after retry on Pro plan. Zendesk sync pending.',
    occurredAt: '2026-05-18T10:00:00.000Z',
    context: seedContext(
      'Acme Pro',
      'Pro Plan',
      'premium',
      'active',
      49,
      'USD',
      '2026-04-18T10:00:00.000Z',
      [
        '2 failed payment attempts in the last 24 hours',
        'Customer previously requested receipt copy',
      ],
      'monthly',
      '2026-06-18T10:00:00.000Z'
    ),
    actorId: 'system',
  }),
  createTicketFromEvent({
    subscriptionId: 'sub_support_2',
    issueType: 'cancellation',
    message: 'Subscription cancellation requires retention review and survey follow-up.',
    occurredAt: '2026-05-19T08:30:00.000Z',
    context: seedContext(
      'Northwind Teams',
      'Team Plan',
      'enterprise',
      'cancel_pending',
      129,
      'USD',
      '2026-01-08T09:30:00.000Z',
      ['Cancellation requested from detail screen', 'Customer cited budget pressure'],
      'yearly',
      '2026-07-08T09:30:00.000Z'
    ),
    actorId: 'system',
  }),
];

export const useSupportStore = create<SupportState>((set, get) => ({
  tickets: seedTickets,
  integration: {
    provider: 'internal',
    enabled: true,
    defaultAssignee: 'support-team',
    baseUrl: 'https://support.local',
    queueName: 'billing-support',
  },

  createTicket: (event) => {
    const existing = findDedupeTicket(get().tickets, event);
    if (existing) {
      const relatedTicketIds = Array.from(
        new Set([...(event.relatedTicketIds ?? []), ...existing.relatedTicketIds])
      );
      const updated = {
        ...existing,
        relatedTicketIds,
        supportContext: enrichContext(existing.supportContext, event.message),
        auditTrail: [
          ...existing.auditTrail,
          buildSupportAuditEntry(
            'dedupe',
            event.actorId ?? 'system',
            'Merged into existing open ticket',
            existing.version + 1,
            {
              dedupeKey: existing.dedupeKey,
            }
          ),
        ],
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };

      set((state) => ({
        tickets: mapTicket(state.tickets, existing.id, () => updated),
      }));
      return updated;
    }

    const ticket = createTicketFromEvent(event, event.relatedTicketIds ?? []);
    set((state) => ({ tickets: [...state.tickets, ticket] }));
    return ticket;
  },

  assignTicket: (ticketId, assignee) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) => assignTicket(ticket, assignee)),
    })),

  updateTicketStatus: (ticketId, status) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) => ({
        ...ticket,
        status,
        version: ticket.version + 1,
        updatedAt: new Date().toISOString(),
        auditTrail: [
          ...ticket.auditTrail,
          buildSupportAuditEntry(
            'note',
            ticket.lastActorId ?? 'system',
            `Status changed to ${status}`,
            ticket.version + 1,
            {
              status,
            }
          ),
        ],
      })),
    })),

  performSupportAction: (ticketId, action, actorId, note = '', expectedVersion) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) =>
        applySupportAction(
          ticket,
          action,
          actorId,
          note || `${action} requested by ${actorId}`,
          expectedVersion
        )
      ),
    })),

  syncTicket: (ticketId) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) =>
        syncTicketToExternalSystem(ticket, get().integration)
      ),
    })),

  linkResolution: (ticketId, subscriptionId) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) =>
        linkTicketResolutionToSubscription(ticket, subscriptionId)
      ),
    })),

  submitSurvey: (ticketId, rating, comment) =>
    set((state) => ({
      tickets: mapTicket(state.tickets, ticketId, (ticket) =>
        recordSupportSurvey(ticket, rating, comment)
      ),
    })),

  setIntegration: (integration) => set({ integration }),
}));
