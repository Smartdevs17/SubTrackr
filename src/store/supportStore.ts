import { create } from 'zustand';
import {
  assignTicket,
  createTicketFromEvent,
  linkTicketResolutionToSubscription,
  syncTicketToExternalSystem,
} from '../services/ticketingService';
import {
  SubscriptionSupportEvent,
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
  syncTicket: (ticketId: string) => void;
  linkResolution: (ticketId: string, subscriptionId: string) => void;
  setIntegration: (integration: TicketingIntegrationConfig) => void;
}

const mapTicket = (
  tickets: SupportTicket[],
  ticketId: string,
  updater: (ticket: SupportTicket) => SupportTicket
): SupportTicket[] => tickets.map((ticket) => (ticket.id === ticketId ? updater(ticket) : ticket));

export const useSupportStore = create<SupportState>((set, get) => ({
  tickets: [],
  integration: { provider: 'internal', enabled: true, defaultAssignee: 'support-team' },

  createTicket: (event) => {
    const relatedTicketIds = get()
      .tickets.filter(
        (ticket) => ticket.subscriptionId === event.subscriptionId && ticket.status !== 'closed'
      )
      .map((ticket) => ticket.id);
    const ticket = createTicketFromEvent(event, relatedTicketIds);
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
        updatedAt: new Date(),
      })),
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

  setIntegration: (integration) => set({ integration }),
}));
