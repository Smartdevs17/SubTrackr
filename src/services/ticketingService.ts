import {
  SubscriptionSupportEvent,
  SupportTicket,
  TicketingIntegrationConfig,
  TicketPriority,
  TicketStatus,
} from '../types/support';

const createId = (): string =>
  `ticket_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const priorityByIssue: Record<SubscriptionSupportEvent['issueType'], TicketPriority> = {
  failed_charge: 'high',
  cancellation: 'medium',
  dispute: 'urgent',
  general: 'low',
};

export const createTicketFromEvent = (
  event: SubscriptionSupportEvent,
  relatedTicketIds: string[] = []
): SupportTicket => {
  const now = new Date();
  return {
    id: createId(),
    subscriptionId: event.subscriptionId,
    issueType: event.issueType,
    priority: event.severity ?? priorityByIssue[event.issueType],
    status: 'open',
    title: `${event.issueType.replace('_', ' ')} for ${event.subscriptionId}`,
    description: event.message,
    relatedTicketIds,
    createdAt: event.occurredAt ?? now,
    updatedAt: now,
  };
};

export const assignTicket = (
  ticket: SupportTicket,
  assignee: string,
  status: TicketStatus = 'assigned'
): SupportTicket => ({
  ...ticket,
  assignee,
  status,
  updatedAt: new Date(),
});

export const syncTicketToExternalSystem = (
  ticket: SupportTicket,
  config: TicketingIntegrationConfig
): SupportTicket => {
  if (!config.enabled) return ticket;

  return {
    ...ticket,
    assignee: ticket.assignee ?? config.defaultAssignee,
    externalSystem: config.provider,
    externalTicketId: ticket.externalTicketId ?? `${config.provider}-${ticket.id}`,
    updatedAt: new Date(),
  };
};

export const linkTicketResolutionToSubscription = (
  ticket: SupportTicket,
  subscriptionId: string
): SupportTicket => ({
  ...ticket,
  resolutionSubscriptionId: subscriptionId,
  status: 'resolved',
  updatedAt: new Date(),
});
