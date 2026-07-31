/**
 * Notification preferences, delivery, history and analytics.
 *
 * Shared vocabulary between the notification domain
 * (`backend/services/notification`) and the client store and service, so both
 * sides agree on channels, types and the shape of a delivery record.
 */

import type { NotificationPriority, OptInCategory } from '../services/pushScheduleEngine';

export type { NotificationPriority, OptInCategory };

/** Where a notification can be delivered. */
export type NotificationChannel = 'email' | 'push' | 'sms' | 'in_app';

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['email', 'push', 'sms', 'in_app'];

/** What a notification is about. Preferences are held per type, per channel. */
export type NotificationType =
  | 'renewal_reminder'
  | 'charge_success'
  | 'charge_failed'
  | 'dunning'
  | 'trial_ending'
  | 'security_alert'
  | 'product_update'
  | 'promotion'
  | 'digest';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'renewal_reminder',
  'charge_success',
  'charge_failed',
  'dunning',
  'trial_ending',
  'security_alert',
  'product_update',
  'promotion',
  'digest',
];

/** Static description of a notification type. */
export interface NotificationTypeMeta {
  type: NotificationType;
  label: string;
  description: string;
  category: OptInCategory;
  priority: NotificationPriority;
  /**
   * A required type cannot be muted, and cannot have every channel disabled —
   * a subscriber must stay reachable about money and account security.
   */
  required: boolean;
  /** Channels enabled by default, in fallback order. */
  defaultChannels: NotificationChannel[];
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  renewal_reminder: {
    type: 'renewal_reminder',
    label: 'Renewal reminders',
    description: 'Heads-up before a subscription renews.',
    category: 'billing',
    priority: 'informative',
    required: false,
    defaultChannels: ['push', 'email'],
  },
  charge_success: {
    type: 'charge_success',
    label: 'Successful payments',
    description: 'Confirmation that a charge went through.',
    category: 'billing',
    priority: 'informative',
    required: false,
    defaultChannels: ['push', 'in_app'],
  },
  charge_failed: {
    type: 'charge_failed',
    label: 'Failed payments',
    description: 'A charge could not be completed.',
    category: 'billing',
    priority: 'critical',
    required: true,
    defaultChannels: ['push', 'email', 'sms'],
  },
  dunning: {
    type: 'dunning',
    label: 'Payment recovery',
    description: 'Retries, warnings and suspensions after a failed payment.',
    category: 'billing',
    priority: 'critical',
    required: true,
    defaultChannels: ['email', 'push'],
  },
  trial_ending: {
    type: 'trial_ending',
    label: 'Trial ending',
    description: 'A free trial is about to convert or expire.',
    category: 'billing',
    priority: 'informative',
    required: false,
    defaultChannels: ['push', 'email'],
  },
  security_alert: {
    type: 'security_alert',
    label: 'Security alerts',
    description: 'New sign-ins, suspicious activity and 2FA prompts.',
    category: 'security',
    priority: 'critical',
    required: true,
    defaultChannels: ['push', 'email', 'sms'],
  },
  product_update: {
    type: 'product_update',
    label: 'Product updates',
    description: 'New features and improvements.',
    category: 'product',
    priority: 'informative',
    required: false,
    defaultChannels: ['in_app'],
  },
  promotion: {
    type: 'promotion',
    label: 'Promotions',
    description: 'Offers, discounts and campaigns.',
    category: 'marketing',
    priority: 'marketing',
    required: false,
    defaultChannels: ['email'],
  },
  digest: {
    type: 'digest',
    label: 'Digests',
    description: 'Batched summary of non-critical activity.',
    category: 'product',
    priority: 'informative',
    required: false,
    defaultChannels: ['email'],
  },
};

/** Per-type preference: which channels are on, and in what fallback order. */
export interface TypePreference {
  type: NotificationType;
  channels: Record<NotificationChannel, boolean>;
  /**
   * Channels tried in order until one accepts the notification. Channels
   * absent from this list are still delivered to, after the listed ones.
   */
  fallbackOrder: NotificationChannel[];
  /** Silences a non-required type entirely, whatever its channels say. */
  muted: boolean;
}

/** Delivery lifecycle of one notification on one channel. */
export type NotificationStatus = 'scheduled' | 'sent' | 'delivered' | 'failed' | 'suppressed';

/** One notification, on one channel, as it appears in history. */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  status: NotificationStatus;
  createdAt: string;
  /** Set when delivery was deferred, e.g. past quiet hours. */
  scheduledFor?: string;
  sentAt?: string;
  readAt?: string;
  clickedAt?: string;
  /** Why the notification was suppressed or failed. */
  reason?: string;
  data?: Record<string, string>;
}

/** Result of attempting one notification across its channels. */
export interface DeliveryResult {
  userId: string;
  type: NotificationType;
  /** Channels that accepted the notification. */
  delivered: NotificationChannel[];
  /** Channels that were tried and failed. */
  failed: NotificationChannel[];
  /** Channels skipped by preference, mute or priority filter. */
  suppressed: NotificationChannel[];
  records: NotificationRecord[];
  /** True when the notification was deferred rather than sent now. */
  scheduled: boolean;
  scheduledFor?: string;
}

/** Engagement counters for one slice of history. */
export interface NotificationStats {
  sent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  opened: number;
  clicked: number;
  /** `delivered / (delivered + failed)`, 0-1. */
  deliveryRate: number;
  /** `opened / delivered`, 0-1. */
  openRate: number;
  /** `clicked / delivered`, 0-1. */
  clickRate: number;
}

export interface NotificationAnalytics {
  totals: NotificationStats;
  byChannel: Record<NotificationChannel, NotificationStats>;
  byType: Record<NotificationType, NotificationStats>;
  unreadCount: number;
  /** Mean milliseconds between sending and reading, over read notifications. */
  averageTimeToReadMs: number;
  /** Channel with the highest open rate over at least one delivery. */
  bestChannel: NotificationChannel | null;
}

/** A reusable message body with `{{variable}}` placeholders. */
export interface NotificationTemplate {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  /** Plain-text subject or push title. */
  subject: string;
  body: string;
  /** Variable names the template expects, used to validate a render. */
  variables: string[];
  version: number;
  updatedAt: string;
}

export interface RenderedTemplate {
  subject: string;
  body: string;
  /** Declared variables that had no value; their placeholders are left blank. */
  missingVariables: string[];
}

/** Filters applied when reading history or computing analytics. */
export interface NotificationHistoryFilter {
  userId?: string;
  type?: NotificationType;
  channel?: NotificationChannel;
  status?: NotificationStatus;
  unreadOnly?: boolean;
  /** ISO-8601 lower bound on `createdAt`, inclusive. */
  since?: string;
  /** ISO-8601 upper bound on `createdAt`, exclusive. */
  until?: string;
}
