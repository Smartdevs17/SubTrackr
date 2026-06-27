/**
 * Support Slice – support ticket management.
 */
import type { StateCreator } from 'zustand';
import { SubscriptionSupportEvent, SupportTicket, TicketingIntegrationConfig, TicketStatus } from '../../types/support';

// ── Interface ───────────────────────────────────────────────────────────

export interface SupportSlice {
  supportTickets: SupportTicket[];
  supportIntegration: TicketingIntegrationConfig;
  createSupportTicket: (event: SubscriptionSupportEvent) => SupportTicket;
  assignSupportTicket: (ticketId: string, assignee: string) => void;
  updateSupportTicketStatus: (ticketId: string, status: TicketStatus) => void;
  syncSupportTicket: (ticketId: string) => void;
  linkSupportResolution: (ticketId: string, subscriptionId: string) => void;
  setSupportIntegration: (integration: TicketingIntegrationConfig) => void;
}

const generateId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const mapTicket = (tickets: SupportTicket[], ticketId: string, updater: (t: SupportTicket) => SupportTicket): SupportTicket[] =>
  tickets.map((t) => (t.id === ticketId ? updater(t) : t));

type SupportStore = SupportSlice;
type SupportCreator = StateCreator<SupportStore & any, [], [], SupportStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createSupportSlice: SupportCreator = (set, get) => ({
  supportTickets: [],
  supportIntegration: { provider: 'internal', enabled: true, defaultAssignee: 'support-team' },

  createSupportTicket: (event) => {
    const ticket: SupportTicket = { id: `ticket-${Date.now()}`, subscriptionId: event.subscriptionId, subject: event.type, description: event.data?.message || '', status: 'open', priority: 'medium', createdAt: new Date(), updatedAt: new Date() } as SupportTicket;
    set((s) => ({ supportTickets: [...s.supportTickets, ticket] }));
    return ticket;
  },

  assignSupportTicket: (ticketId, assignee) =>
    set((s) => ({ supportTickets: mapTicket(s.supportTickets, ticketId, (t) => ({ ...t, assignee, updatedAt: new Date() })) })),

  updateSupportTicketStatus: (ticketId, status) =>
    set((s) => ({ supportTickets: mapTicket(s.supportTickets, ticketId, (t) => ({ ...t, status, updatedAt: new Date() })) })),

  syncSupportTicket: (ticketId) =>
    set((s) => ({ supportTickets: mapTicket(s.supportTickets, ticketId, (t) => ({ ...t, syncedAt: new Date() })) })),

  linkSupportResolution: (ticketId, subscriptionId) =>
    set((s) => ({ supportTickets: mapTicket(s.supportTickets, ticketId, (t) => ({ ...t, resolvedForSubscriptionId: subscriptionId, status: 'resolved', updatedAt: new Date() })) })),

  setSupportIntegration: (integration) => set({ supportIntegration: integration }),
});
