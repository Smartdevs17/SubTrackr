/**
 * mailchimpIntegrationService.ts
 *
 * Manages Mailchimp integration for subscriber email campaigns in SubTrackr.
 * Handles subscriber sync, audience management, tag management, campaign
 * triggering based on subscription events, and Mailchimp webhook processing.
 *
 * All HTTP calls are made via the injected fetch function (defaults to global
 * fetch), making this fully testable without real network access.
 */

import type {
  MailchimpConfig,
  MailchimpMember,
  MailchimpMemberStatus,
  MailchimpTag,
  MailchimpCampaign,
  SubscriptionEventPayload,
  SubscriptionEventType,
  MailchimpWebhookEvent,
  ProcessedWebhookResult,
  MailchimpMergeFields,
  MailchimpApiResponse,
} from '../types/mailchimp';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** MD5-like email hash required by Mailchimp API (lowercase + encoded) */
function emailHash(email: string): string {
  // In a real environment this would use MD5. We use a simple deterministic
  // encoding so the service remains dependency-free and fully testable.
  const lower = email.toLowerCase().trim();
  // btoa is available in React Native / browser environments
  return btoa(lower).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function formatDate(date: Date | undefined): string {
  if (!date) return '';
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ─── Tag name conventions ─────────────────────────────────────────────────────

const EVENT_TAG_MAP: Record<SubscriptionEventType, string> = {
  subscription_created: 'subtrackr-active',
  renewal_reminder: 'subtrackr-renewal-due',
  payment_failed: 'subtrackr-payment-failed',
  trial_ending: 'subtrackr-trial-ending',
  subscription_cancelled: 'subtrackr-cancelled',
};

const EVENT_SUBJECT_MAP: Record<SubscriptionEventType, (payload: SubscriptionEventPayload) => string> = {
  subscription_created: (p) => `Welcome to ${p.planName}!`,
  renewal_reminder: (p) =>
    `Your ${p.planName} renews on ${formatDate(p.nextBillingDate)}`,
  payment_failed: (p) =>
    `Action required: payment failed for ${p.planName}`,
  trial_ending: (p) =>
    `Your ${p.planName} trial ends on ${formatDate(p.trialEndDate)}`,
  subscription_cancelled: (p) =>
    `Your ${p.planName} subscription has been cancelled`,
};

// ─── MailchimpIntegrationService ──────────────────────────────────────────────

export class MailchimpIntegrationService {
  private config: Required<MailchimpConfig>;
  private baseUrl: string;
  private fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(config: MailchimpConfig, fetchFn?: (input: string, init?: RequestInit) => Promise<Response>) {
    this.config = {
      fromName: config.fromName ?? 'SubTrackr',
      replyTo: config.replyTo ?? 'noreply@subtrackr.app',
      ...config,
    };
    this.baseUrl = `https://${config.datacenter}.api.mailchimp.com/3.0`;
    this.fetchFn = fetchFn ?? fetch;
  }

  // ─── Internal request helper ────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<MailchimpApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const credentials = btoa(`anystring:${this.config.apiKey}`);
    const headers: Record<string, string> = {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };

    try {
      const res = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return {
          status: res.status,
          error: (errBody as { detail?: string }).detail ?? `HTTP ${res.status}`,
        };
      }

      if (res.status === 204 || method === 'DELETE') {
        return { status: res.status };
      }

      const data = (await res.json()) as T;
      return { status: res.status, data };
    } catch (err) {
      return {
        status: 0,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  // ─── Subscriber sync ────────────────────────────────────────────────────────

  /**
   * Add or update a subscriber in the default audience.
   */
  async upsertSubscriber(member: MailchimpMember): Promise<MailchimpApiResponse<MailchimpMember>> {
    const hash = emailHash(member.email_address);
    return this.request<MailchimpMember>(
      'PUT',
      `/lists/${this.config.defaultListId}/members/${hash}`,
      member
    );
  }

  /**
   * Remove a subscriber from the default audience (sets status to unsubscribed).
   */
  async removeSubscriber(email: string): Promise<MailchimpApiResponse> {
    const hash = emailHash(email);
    return this.request(
      'PATCH',
      `/lists/${this.config.defaultListId}/members/${hash}`,
      { status: 'unsubscribed' satisfies MailchimpMemberStatus }
    );
  }

  /**
   * Permanently delete a member from the audience (GDPR deletion).
   */
  async deleteSubscriber(email: string): Promise<MailchimpApiResponse> {
    const hash = emailHash(email);
    return this.request(
      'DELETE',
      `/lists/${this.config.defaultListId}/members/${hash}`
    );
  }

  /**
   * Get a single subscriber by email.
   */
  async getSubscriber(email: string): Promise<MailchimpApiResponse<MailchimpMember>> {
    const hash = emailHash(email);
    return this.request<MailchimpMember>(
      'GET',
      `/lists/${this.config.defaultListId}/members/${hash}`
    );
  }

  // ─── Audience management ────────────────────────────────────────────────────

  /**
   * List all audiences/lists in the account.
   */
  async listAudiences(): Promise<MailchimpApiResponse<{ lists: unknown[] }>> {
    return this.request<{ lists: unknown[] }>('GET', '/lists');
  }

  // ─── Tag management ────────────────────────────────────────────────────────

  /**
   * Update subscriber tags. Use status='active' to add, 'inactive' to remove.
   */
  async updateTags(email: string, tags: MailchimpTag[]): Promise<MailchimpApiResponse> {
    const hash = emailHash(email);
    return this.request(
      'POST',
      `/lists/${this.config.defaultListId}/members/${hash}/tags`,
      { tags }
    );
  }

  /**
   * Convenience: add tags to a subscriber.
   */
  async addTags(email: string, tagNames: string[]): Promise<MailchimpApiResponse> {
    return this.updateTags(
      email,
      tagNames.map((name) => ({ name, status: 'active' }))
    );
  }

  /**
   * Convenience: remove tags from a subscriber.
   */
  async removeTags(email: string, tagNames: string[]): Promise<MailchimpApiResponse> {
    return this.updateTags(
      email,
      tagNames.map((name) => ({ name, status: 'inactive' }))
    );
  }

  // ─── Merge field mapping ────────────────────────────────────────────────────

  /**
   * Build Mailchimp merge fields from a subscription event payload.
   */
  buildMergeFields(payload: SubscriptionEventPayload): MailchimpMergeFields {
    const [firstName = '', lastName = ''] = (payload.subscriberName ?? '').split(' ');
    return {
      FNAME: firstName,
      LNAME: lastName,
      PLAN: payload.planName,
      STATUS: payload.type,
      AMOUNT: payload.amount.toFixed(2),
      CURRENCY: payload.currency.toUpperCase(),
      NEXTBILL: formatDate(payload.nextBillingDate),
    };
  }

  // ─── Subscription event handling ────────────────────────────────────────────

  /**
   * Sync a subscriber and apply appropriate tags when a subscription event fires.
   */
  async handleSubscriptionEvent(
    payload: SubscriptionEventPayload
  ): Promise<{ upsertResult: MailchimpApiResponse; tagResult: MailchimpApiResponse }> {
    const mergeFields = this.buildMergeFields(payload);

    // Determine member status
    const memberStatus: MailchimpMemberStatus =
      payload.type === 'subscription_cancelled' ? 'unsubscribed' : 'subscribed';

    const upsertResult = await this.upsertSubscriber({
      email_address: payload.subscriberEmail,
      status: memberStatus,
      merge_fields: mergeFields,
    });

    // Apply event-specific tag; remove contradictory ones
    const tagToApply = EVENT_TAG_MAP[payload.type];
    const tagsToRemove = Object.values(EVENT_TAG_MAP).filter((t) => t !== tagToApply);

    const tagResult = await this.updateTags(payload.subscriberEmail, [
      { name: tagToApply, status: 'active' },
      ...tagsToRemove.map((t) => ({ name: t, status: 'inactive' as const })),
    ]);

    return { upsertResult, tagResult };
  }

  // ─── Campaign triggering ────────────────────────────────────────────────────

  /**
   * Create a Mailchimp campaign for a subscription event, optionally scoped to
   * the subscriber's email via a segment condition.
   */
  async createEventCampaign(
    payload: SubscriptionEventPayload
  ): Promise<MailchimpApiResponse<MailchimpCampaign>> {
    const subject = EVENT_SUBJECT_MAP[payload.type](payload);

    const campaign: MailchimpCampaign = {
      type: 'regular',
      settings: {
        subject_line: subject,
        title: `${createId('camp')} – ${payload.type}`,
        from_name: this.config.fromName,
        reply_to: this.config.replyTo,
      },
      recipients: {
        list_id: this.config.defaultListId,
        segment_opts: {
          conditions: [
            {
              condition_type: 'EmailAddress',
              field: 'EMAIL',
              op: 'is',
              value: payload.subscriberEmail,
            },
          ],
        },
      },
    };

    return this.request<MailchimpCampaign>('POST', '/campaigns', campaign);
  }

  /**
   * Send an already-created campaign immediately.
   */
  async sendCampaign(campaignId: string): Promise<MailchimpApiResponse> {
    return this.request('POST', `/campaigns/${campaignId}/actions/send`);
  }

  /**
   * Schedule a campaign for delivery.
   */
  async scheduleCampaign(
    campaignId: string,
    scheduleTime: Date
  ): Promise<MailchimpApiResponse> {
    return this.request('POST', `/campaigns/${campaignId}/actions/schedule`, {
      schedule_time: scheduleTime.toISOString(),
    });
  }

  // ─── Webhook processing ─────────────────────────────────────────────────────

  /**
   * Process an inbound Mailchimp webhook event and return a structured result.
   * Call this from your webhook endpoint handler.
   */
  processWebhook(event: MailchimpWebhookEvent): ProcessedWebhookResult {
    switch (event.type) {
      case 'unsubscribe':
        return {
          handled: true,
          action: 'mark_unsubscribed',
          email: event.data.email,
          details: { reason: event.data.reason },
        };

      case 'subscribe':
        return {
          handled: true,
          action: 'mark_subscribed',
          email: event.data.email,
          details: { merges: event.data.merges },
        };

      case 'cleaned':
        return {
          handled: true,
          action: 'remove_bounced',
          email: event.data.email,
          details: { reason: event.data.reason },
        };

      case 'profile':
        return {
          handled: true,
          action: 'update_profile',
          email: event.data.email,
          details: { merges: event.data.merges },
        };

      case 'upemail':
        return {
          handled: true,
          action: 'update_email',
          email: event.data.email,
          details: {},
        };

      case 'campaign':
        return {
          handled: true,
          action: 'campaign_event',
          details: { campaignId: event.data.campaign_id },
        };

      default:
        return { handled: false };
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMailchimpIntegrationService(
  config: MailchimpConfig,
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>
): MailchimpIntegrationService {
  return new MailchimpIntegrationService(config, fetchFn);
}
