export type TicketIssueType = 'failed_charge' | 'cancellation' | 'dispute' | 'general';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'assigned' | 'pending_customer' | 'resolved' | 'closed';
export type SupportActionType = 'refund' | 'pause' | 'cancel' | 'escalate' | 'note';
export type SupportSlaStatus = 'on_track' | 'at_risk' | 'breached' | 'resolved';
export type SupportSurveyStatus = 'not_sent' | 'sent' | 'completed';

export interface SubscriptionSupportContext {
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

export interface SupportAuditEntry {
  id: string;
  action: SupportActionType | 'create' | 'sync' | 'resolve' | 'dedupe' | 'survey';
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

export interface SupportSlaRecord {
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  status: SupportSlaStatus;
  breached: boolean;
}

export interface SupportSurveyRecord {
  status: SupportSurveyStatus;
  rating?: number;
  comment?: string;
  sentAt?: string;
  completedAt?: string;
}

export interface SupportTicket {
  id: string;
  subscriptionId: string;
  issueType: TicketIssueType;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  description: string;
  assignee?: string;
  externalSystem?: string;
  externalTicketId?: string;
  resolutionSubscriptionId?: string;
  relatedTicketIds: string[];
  createdAt: string;
  updatedAt: string;
  supportContext: SubscriptionSupportContext;
  auditTrail: SupportAuditEntry[];
  actions: SupportActionRecord[];
  sla: SupportSlaRecord;
  survey: SupportSurveyRecord;
  dedupeKey: string;
  version: number;
  lastActorId?: string;
}

export interface SubscriptionSupportEvent {
  subscriptionId: string;
  issueType: TicketIssueType;
  message: string;
  severity?: TicketPriority;
  occurredAt: string | Date;
  context: SubscriptionSupportContext;
  dedupeKey?: string;
  relatedTicketIds?: string[];
  actorId?: string;
}

export interface TicketingIntegrationConfig {
  provider: 'zendesk' | 'freshdesk' | 'intercom' | 'internal';
  enabled: boolean;
  defaultAssignee?: string;
  apiKey?: string;
  baseUrl?: string;
  queueName?: string;
}
