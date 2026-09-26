/**
 * Mailchimp integration types for SubTrackr subscriber email management.
 */

// ─── Member / Audience ────────────────────────────────────────────────────────

export type MailchimpMemberStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'cleaned'
  | 'pending'
  | 'transactional';

export interface MailchimpMergeFields {
  FNAME?: string;
  LNAME?: string;
  PLAN?: string;
  STATUS?: string;
  AMOUNT?: string;
  CURRENCY?: string;
  NEXTBILL?: string;
  [key: string]: string | undefined;
}

export interface MailchimpTag {
  name: string;
  status: 'active' | 'inactive';
}

export interface MailchimpMember {
  id?: string;
  email_address: string;
  status: MailchimpMemberStatus;
  merge_fields: MailchimpMergeFields;
  tags?: string[];
  timestamp_opt?: string;
  timestamp_signup?: string;
  last_changed?: string;
}

export interface MailchimpAudience {
  id: string;
  name: string;
  stats?: {
    member_count: number;
    unsubscribe_count: number;
  };
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export type MailchimpCampaignType =
  | 'regular'
  | 'plaintext'
  | 'absplit'
  | 'rss'
  | 'variate'
  | 'automation';

export interface MailchimpCampaign {
  id?: string;
  type: MailchimpCampaignType;
  status?: 'save' | 'paused' | 'schedule' | 'sending' | 'sent';
  settings: {
    subject_line: string;
    preview_text?: string;
    title: string;
    from_name: string;
    reply_to: string;
  };
  recipients: {
    list_id: string;
    segment_opts?: {
      conditions: Array<{ condition_type: string; field: string; op: string; value: string }>;
    };
  };
  send_time?: string;
}

// ─── Subscription events ──────────────────────────────────────────────────────

export type SubscriptionEventType =
  | 'renewal_reminder'
  | 'payment_failed'
  | 'trial_ending'
  | 'subscription_cancelled'
  | 'subscription_created';

export interface SubscriptionEventPayload {
  type: SubscriptionEventType;
  subscriptionId: string;
  subscriberEmail: string;
  subscriberName?: string;
  planName: string;
  amount: number;
  currency: string;
  nextBillingDate?: Date;
  trialEndDate?: Date;
  cancelledAt?: Date;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export type MailchimpWebhookType =
  | 'subscribe'
  | 'unsubscribe'
  | 'profile'
  | 'cleaned'
  | 'upemail'
  | 'campaign';

export interface MailchimpWebhookEvent {
  type: MailchimpWebhookType;
  fired_at: string;
  data: {
    email?: string;
    email_type?: string;
    id?: string;
    list_id?: string;
    merges?: Record<string, string>;
    reason?: string;
    campaign_id?: string;
  };
}

export interface ProcessedWebhookResult {
  handled: boolean;
  action?: string;
  email?: string;
  details?: Record<string, unknown>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface MailchimpConfig {
  apiKey: string;
  /** Mailchimp datacenter prefix (e.g. 'us1', 'us6') */
  datacenter: string;
  /** Default audience/list ID for subscriber sync */
  defaultListId: string;
  /** Sender name for campaigns */
  fromName?: string;
  /** Reply-to address for campaigns */
  replyTo?: string;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface MailchimpApiResponse<T = unknown> {
  status: number;
  data?: T;
  error?: string;
}
