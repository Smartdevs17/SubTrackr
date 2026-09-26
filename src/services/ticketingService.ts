import {
  SubscriptionSupportContext,
  SubscriptionSupportEvent,
  SupportActionRecord,
  SupportAuditEntry,
  SupportSlaRecord,
  SupportTicket,
  TicketingIntegrationConfig,
  TicketIssueType,
  TicketPriority,
  TicketStatus,
} from '../types/support';

const createId = (): string =>
  `ticket_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const toIso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const uniqueStrings = (values: (string | undefined)[]): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const priorityByIssue: Record<TicketIssueType, TicketPriority> = {
  failed_charge: 'high',
  cancellation: 'medium',
  dispute: 'urgent',
  general: 'low',
};

const slaByPriority: Record<
  TicketPriority,
  { firstResponseHours: number; resolutionHours: number }
> = {
  low: { firstResponseHours: 24, resolutionHours: 72 },
  medium: { firstResponseHours: 8, resolutionHours: 48 },
  high: { firstResponseHours: 4, resolutionHours: 24 },
  urgent: { firstResponseHours: 1, resolutionHours: 8 },
};

export const buildSupportContext = (
  event: SubscriptionSupportEvent
): SubscriptionSupportContext => ({
  ...event.context,
});

export const buildSupportDedupeKey = (event: SubscriptionSupportEvent): string =>
  event.dedupeKey ??
  `${event.subscriptionId}:${event.issueType}:${toIso(event.occurredAt).slice(0, 10)}`;

export const buildSupportAuditEntry = (
  action: SupportAuditEntry['action'],
  actorId: string,
  note: string,
  version: number,
  metadata: SupportAuditEntry['metadata'] = {}
): SupportAuditEntry => ({
  id: createId(),
  action,
  actorId,
  note,
  createdAt: new Date().toISOString(),
  version,
  metadata,
});

export const calculateSupportSla = (
  issueType: TicketIssueType,
  priority: TicketPriority,
  createdAt: string
): SupportSlaRecord => {
  const schedule = slaByPriority[priorityByIssue[issueType] ?? priority];
  const createdAtMs = new Date(createdAt).getTime();
  const firstResponseDueAt = new Date(
    createdAtMs + schedule.firstResponseHours * 60 * 60 * 1000
  ).toISOString();
  const resolutionDueAt = new Date(
    createdAtMs + schedule.resolutionHours * 60 * 60 * 1000
  ).toISOString();

  return {
    firstResponseDueAt,
    resolutionDueAt,
    status: 'on_track',
    breached: false,
  };
};

const normalizeAction = (action: SupportActionRecord['action']): TicketStatus => {
  if (action === 'refund' || action === 'pause' || action === 'cancel') return 'resolved';
  return 'assigned';
};

export const createTicketFromEvent = (
  event: SubscriptionSupportEvent,
  relatedTicketIds: string[] = []
): SupportTicket => {
  const createdAt = toIso(event.occurredAt);
  const context = buildSupportContext(event);
  const dedupeKey = buildSupportDedupeKey(event);
  const relatedIds = uniqueStrings([...(event.relatedTicketIds ?? []), ...relatedTicketIds]);
  const priority = event.severity ?? priorityByIssue[event.issueType];
  const auditTrail = [
    buildSupportAuditEntry('create', event.actorId ?? 'system', event.message, 1, {
      issueType: event.issueType,
      dedupeKey,
    }),
  ];

  return {
    id: createId(),
    subscriptionId: event.subscriptionId,
    issueType: event.issueType,
    priority,
    status: 'open',
    title: `${context.subscriptionName} ${event.issueType.replace('_', ' ')}`,
    description: event.message,
    relatedTicketIds: relatedIds,
    createdAt,
    updatedAt: createdAt,
    supportContext: context,
    auditTrail,
    actions: [],
    sla: calculateSupportSla(event.issueType, priority, createdAt),
    survey: { status: 'not_sent' },
    dedupeKey,
    version: 1,
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
  version: ticket.version + 1,
  updatedAt: new Date().toISOString(),
  lastActorId: assignee,
  auditTrail: [
    ...ticket.auditTrail,
    buildSupportAuditEntry('note', assignee, `Assigned to ${assignee}`, ticket.version + 1, {
      assignee,
      status,
    }),
  ],
});

export const applySupportAction = (
  ticket: SupportTicket,
  action: SupportActionRecord['action'],
  actorId: string,
  note: string,
  expectedVersion?: number
): SupportTicket => {
  const versionMismatch = expectedVersion !== undefined && expectedVersion !== ticket.version;
  const nextVersion = ticket.version + 1;
  const nextStatus = versionMismatch ? ticket.status : normalizeAction(action);

  return {
    ...ticket,
    status: nextStatus,
    version: nextVersion,
    updatedAt: new Date().toISOString(),
    lastActorId: actorId,
    actions: [
      ...ticket.actions,
      {
        action,
        actorId,
        note,
        createdAt: new Date().toISOString(),
        version: nextVersion,
        conflict: versionMismatch,
      },
    ],
    auditTrail: [
      ...ticket.auditTrail,
      buildSupportAuditEntry(
        versionMismatch ? 'dedupe' : action,
        actorId,
        note,
        nextVersion,
        versionMismatch
          ? { expectedVersion, actualVersion: ticket.version }
          : { status: nextStatus }
      ),
    ],
  };
};

export const syncTicketToExternalSystem = (
  ticket: SupportTicket,
  config: TicketingIntegrationConfig
): SupportTicket => {
  if (!config.enabled) return ticket;

  const externalSystem = config.provider;
  const externalTicketId = ticket.externalTicketId ?? `${config.provider}-${ticket.id}`;

  return {
    ...ticket,
    assignee: ticket.assignee ?? config.defaultAssignee,
    externalSystem,
    externalTicketId,
    updatedAt: new Date().toISOString(),
    auditTrail: [
      ...ticket.auditTrail,
      buildSupportAuditEntry(
        'sync',
        ticket.lastActorId ?? 'system',
        `Synced to ${externalSystem}`,
        ticket.version,
        {
          provider: externalSystem,
          queueName: config.queueName ?? '',
        }
      ),
    ],
  };
};

export const linkTicketResolutionToSubscription = (
  ticket: SupportTicket,
  subscriptionId: string,
  resolutionNote = 'Resolved against subscription'
): SupportTicket => ({
  ...ticket,
  resolutionSubscriptionId: subscriptionId,
  status: 'resolved',
  updatedAt: new Date().toISOString(),
  sla: {
    ...ticket.sla,
    resolvedAt: new Date().toISOString(),
    status: 'resolved',
    breached: ticket.sla.breached,
  },
  survey: {
    ...ticket.survey,
    status: ticket.survey.status === 'completed' ? 'completed' : 'sent',
    sentAt: ticket.survey.sentAt ?? new Date().toISOString(),
  },
  auditTrail: [
    ...ticket.auditTrail,
    buildSupportAuditEntry(
      'resolve',
      ticket.lastActorId ?? 'system',
      resolutionNote,
      ticket.version,
      {
        subscriptionId,
      }
    ),
  ],
});

export const recordSupportSurvey = (
  ticket: SupportTicket,
  rating: number,
  comment?: string
): SupportTicket => ({
  ...ticket,
  survey: {
    status: 'completed',
    rating,
    comment,
    sentAt: ticket.survey.sentAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
  },
  updatedAt: new Date().toISOString(),
  auditTrail: [
    ...ticket.auditTrail,
    buildSupportAuditEntry(
      'survey',
      ticket.lastActorId ?? 'customer',
      'Customer survey submitted',
      ticket.version,
      {
        rating,
      }
    ),
  ],
});

export const buildSupportEventMessage = (
  context: SubscriptionSupportContext,
  issueType: TicketIssueType
): string => {
  const base =
    issueType === 'failed_charge'
      ? 'A subscription payment failed and needs review.'
      : issueType === 'cancellation'
        ? 'A subscription was cancelled and needs support follow-up.'
        : issueType === 'dispute'
          ? 'A billing dispute was opened by the customer.'
          : 'A support ticket was created for subscription billing.';

  return `${base} Plan ${context.planName} is ${context.status}.`;
};
