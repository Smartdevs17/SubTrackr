import { randomUUID } from 'crypto';

export type SupportIssueType = 'failed_charge' | 'cancellation' | 'dispute' | 'general';
export type SupportActionType = 'refund' | 'pause' | 'cancel' | 'escalate' | 'note';
export type SupportProvider = 'zendesk' | 'intercom' | 'freshdesk' | 'internal';

export interface SupportTicketContext {
  subscriptionId: string;
  subscriptionName: string;
  planName: string;
  planTier: string;
  billingCycle: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  nextBillingDate?: string;
  failedPayments: number;
  chargeCount: number;
  history: string[];
}

export interface SupportTicketRecord {
  id: string;
  subscriptionId: string;
  issueType: SupportIssueType;
  status: 'open' | 'assigned' | 'pending_customer' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  description: string;
  dedupeKey: string;
  relatedTicketIds: string[];
  context: SupportTicketContext;
  actions: SupportActionRecord[];
  auditTrail: SupportAuditEntry[];
  sla: SupportSlaSnapshot;
  externalTicketId?: string;
  externalProvider?: SupportProvider;
  version: number;
}

export interface SupportAuditEntry {
  id: string;
  action: SupportActionType | 'create' | 'sync' | 'dedupe' | 'resolve';
  actorId: string;
  note: string;
  createdAt: string;
  version: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SupportActionRecord {
  action: SupportActionType;
  actorId: string;
  note: string;
  createdAt: string;
  version: number;
  conflict?: boolean;
}

export interface SupportSlaSnapshot {
  firstResponseDueAt: string;
  resolutionDueAt: string;
  status: 'on_track' | 'at_risk' | 'breached' | 'resolved';
  breached: boolean;
}

const priorityForIssue: Record<SupportIssueType, SupportTicketRecord['priority']> = {
  failed_charge: 'high',
  cancellation: 'medium',
  dispute: 'urgent',
  general: 'low',
};

const slaByPriority: Record<SupportTicketRecord['priority'], { firstResponseHours: number; resolutionHours: number }> = {
  low: { firstResponseHours: 24, resolutionHours: 72 },
  medium: { firstResponseHours: 8, resolutionHours: 48 },
  high: { firstResponseHours: 4, resolutionHours: 24 },
  urgent: { firstResponseHours: 1, resolutionHours: 8 },
};

const createId = (): string => `support_${randomUUID()}`;

const uniqueStrings = (values: (string | undefined)[]): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

export const calculateSupportSla = (
  issueType: SupportIssueType,
  createdAt: string,
  priority: SupportTicketRecord['priority'] = priorityForIssue[issueType]
): SupportSlaSnapshot => {
  const schedule = slaByPriority[priority];
  const base = new Date(createdAt).getTime();
  return {
    firstResponseDueAt: new Date(base + schedule.firstResponseHours * 60 * 60 * 1000).toISOString(),
    resolutionDueAt: new Date(base + schedule.resolutionHours * 60 * 60 * 1000).toISOString(),
    status: 'on_track',
    breached: false,
  };
};

export const buildSupportTicket = (input: {
  subscriptionId: string;
  issueType: SupportIssueType;
  summary: string;
  createdAt: string;
  context: SupportTicketContext;
  relatedTicketIds?: string[];
  dedupeKey?: string;
}): SupportTicketRecord => {
  const priority = priorityForIssue[input.issueType];
  const dedupeKey = input.dedupeKey ?? `${input.subscriptionId}:${input.issueType}:${input.createdAt.slice(0, 10)}`;
  const relatedTicketIds = uniqueStrings(input.relatedTicketIds ?? []);
  return {
    id: createId(),
    subscriptionId: input.subscriptionId,
    issueType: input.issueType,
    status: 'open',
    priority,
    title: `${input.context.subscriptionName} ${input.issueType.replace('_', ' ')}`,
    description: input.summary,
    dedupeKey,
    relatedTicketIds,
    context: input.context,
    actions: [],
    auditTrail: [
      {
        id: createId(),
        action: 'create',
        actorId: 'system',
        note: input.summary,
        createdAt: input.createdAt,
        version: 1,
      },
    ],
    sla: calculateSupportSla(input.issueType, input.createdAt, priority),
    version: 1,
  };
};

export const dedupeSupportTickets = (
  existingTickets: SupportTicketRecord[],
  candidate: SupportTicketRecord
): SupportTicketRecord => {
  const match = existingTickets.find(
    (ticket) =>
      ticket.subscriptionId === candidate.subscriptionId &&
      ticket.issueType === candidate.issueType &&
      ticket.status !== 'closed'
  );

  if (!match) return candidate;

  return {
    ...match,
    relatedTicketIds: uniqueStrings([...match.relatedTicketIds, candidate.id, ...candidate.relatedTicketIds]),
    context: {
      ...match.context,
      history: uniqueStrings([...match.context.history, ...candidate.context.history, candidate.description]),
    },
    version: match.version + 1,
    auditTrail: [
      ...match.auditTrail,
      {
        id: createId(),
        action: 'dedupe',
        actorId: 'system',
        note: `Merged ${candidate.id} into existing ticket`,
        createdAt: new Date().toISOString(),
        version: match.version + 1,
        metadata: { mergedTicketId: candidate.id },
      },
    ],
  };
};

export const recordSupportAction = (
  ticket: SupportTicketRecord,
  action: SupportActionType,
  actorId: string,
  note: string,
  expectedVersion?: number
): SupportTicketRecord => {
  const conflict = expectedVersion !== undefined && expectedVersion !== ticket.version;
  const nextVersion = ticket.version + 1;
  const nextStatus = action === 'refund' || action === 'pause' || action === 'cancel' ? 'resolved' : 'assigned';

  return {
    ...ticket,
    status: conflict ? ticket.status : nextStatus,
    version: nextVersion,
    actions: [
      ...ticket.actions,
      {
        action,
        actorId,
        note,
        createdAt: new Date().toISOString(),
        version: nextVersion,
        conflict,
      },
    ],
    auditTrail: [
      ...ticket.auditTrail,
      {
        id: createId(),
        action: conflict ? 'note' : action,
        actorId,
        note: conflict ? `Conflict: ${note}` : note,
        createdAt: new Date().toISOString(),
        version: nextVersion,
        metadata: conflict ? { expectedVersion: expectedVersion ?? -1, actualVersion: ticket.version } : { status: nextStatus },
      },
    ],
  };
};

export const recordExternalSync = (
  ticket: SupportTicketRecord,
  provider: SupportProvider,
  baseUrl?: string
): SupportTicketRecord => ({
  ...ticket,
  externalProvider: provider,
  externalTicketId: ticket.externalTicketId ?? `${provider}-${ticket.id}`,
  auditTrail: [
    ...ticket.auditTrail,
    {
      id: createId(),
      action: 'sync',
      actorId: 'system',
      note: `Synced to ${provider}`,
      createdAt: new Date().toISOString(),
      version: ticket.version,
      metadata: { provider, baseUrl: baseUrl ?? '' },
    },
  ],
});

export const buildExternalPayload = (ticket: SupportTicketRecord, provider: SupportProvider) => ({
  provider,
  ticketId: ticket.id,
  subscriptionId: ticket.subscriptionId,
  title: ticket.title,
  description: ticket.description,
  status: ticket.status,
  priority: ticket.priority,
  context: ticket.context,
  sla: ticket.sla,
  actions: ticket.actions,
  relatedTicketIds: ticket.relatedTicketIds,
});
