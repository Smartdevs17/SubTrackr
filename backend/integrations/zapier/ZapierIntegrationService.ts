/**
 * Zapier Integration Service
 *
 * Provides the backend for SubTrackr's Zapier integration, enabling no-code
 * workflows by exposing:
 *
 *   Triggers  — REST hooks that call a Zap when a SubTrackr event occurs.
 *   Actions   — REST endpoints Zapier calls to perform operations in SubTrackr.
 *   Searches  — Read-only lookups Zapier uses to enrich data in workflows.
 *
 * All communication is authenticated with an API key carried in the
 * X-Api-Key header.
 *
 * REST-hook pattern:
 *   1. Zapier POSTs a subscription to /zapier/hooks with a target URL.
 *   2. SubTrackr stores it and fires the URL whenever the event occurs.
 *   3. Zapier DELETEs /zapier/hooks/:id when a Zap is turned off.
 */

import crypto from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZapierTriggerEvent =
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.updated'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.overdue'
  | 'trial.started'
  | 'trial.ending'
  | 'trial.ended'
  | 'renewal.upcoming'
  | 'renewal.completed';

export type ZapierActionType =
  | 'create_subscription'
  | 'cancel_subscription'
  | 'pause_subscription'
  | 'resume_subscription'
  | 'update_subscription'
  | 'create_invoice'
  | 'send_notification';

export type ZapierSearchType =
  | 'find_subscription'
  | 'find_customer'
  | 'find_invoice'
  | 'find_plan';

export interface ZapierHookSubscription {
  id: string;
  merchantId: string;
  targetUrl: string;
  event: ZapierTriggerEvent;
  /** Shared secret for payload signing delivered to Zapier */
  signingSecret: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
  failureCount: number;
}

export interface ZapierWebhookPayload {
  id: string;
  event: ZapierTriggerEvent;
  merchantId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface ZapierActionPayload {
  merchantId: string;
  action: ZapierActionType;
  params: Record<string, unknown>;
}

export interface ZapierActionResult {
  success: boolean;
  id?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ZapierSearchParams {
  merchantId: string;
  searchType: ZapierSearchType;
  query: Record<string, unknown>;
}

export interface ZapierSearchResult {
  success: boolean;
  results: Record<string, unknown>[];
  count: number;
}

export interface RegisterHookInput {
  merchantId: string;
  targetUrl: string;
  event: ZapierTriggerEvent;
}

export interface ZapierTriggerDefinition {
  key: ZapierTriggerEvent;
  label: string;
  description: string;
  samplePayload: Record<string, unknown>;
}

export interface ZapierActionDefinition {
  key: ZapierActionType;
  label: string;
  description: string;
  inputFields: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'datetime';
    required: boolean;
    helpText?: string;
  }>;
}

// ── Trigger catalog ───────────────────────────────────────────────────────────

export const ZAPIER_TRIGGER_DEFINITIONS: ZapierTriggerDefinition[] = [
  {
    key: 'subscription.created',
    label: 'New Subscription',
    description: 'Triggers when a new subscription is created.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', amount: 49.99, currency: 'USD', status: 'active', billingCycle: 'monthly' },
  },
  {
    key: 'subscription.cancelled',
    label: 'Subscription Cancelled',
    description: 'Triggers when a subscription is cancelled.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', cancelledAt: new Date().toISOString() },
  },
  {
    key: 'subscription.paused',
    label: 'Subscription Paused',
    description: 'Triggers when a subscription is paused.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', pausedAt: new Date().toISOString() },
  },
  {
    key: 'subscription.resumed',
    label: 'Subscription Resumed',
    description: 'Triggers when a paused subscription is resumed.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', resumedAt: new Date().toISOString() },
  },
  {
    key: 'payment.succeeded',
    label: 'Payment Succeeded',
    description: 'Triggers when a payment is successfully processed.',
    samplePayload: { id: 'pay_sample', subscriptionId: 'sub_sample', amount: 49.99, currency: 'USD', paidAt: new Date().toISOString() },
  },
  {
    key: 'payment.failed',
    label: 'Payment Failed',
    description: 'Triggers when a payment attempt fails.',
    samplePayload: { id: 'pay_sample', subscriptionId: 'sub_sample', amount: 49.99, currency: 'USD', reason: 'insufficient_funds' },
  },
  {
    key: 'invoice.created',
    label: 'Invoice Created',
    description: 'Triggers when a new invoice is generated.',
    samplePayload: { id: 'inv_sample', subscriptionId: 'sub_sample', amount: 49.99, currency: 'USD', dueAt: new Date().toISOString() },
  },
  {
    key: 'invoice.paid',
    label: 'Invoice Paid',
    description: 'Triggers when an invoice is marked as paid.',
    samplePayload: { id: 'inv_sample', subscriptionId: 'sub_sample', amount: 49.99, paidAt: new Date().toISOString() },
  },
  {
    key: 'renewal.upcoming',
    label: 'Renewal Upcoming',
    description: 'Triggers 7 days before a subscription renewal.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', renewalDate: new Date().toISOString(), amount: 49.99, currency: 'USD' },
  },
  {
    key: 'renewal.completed',
    label: 'Renewal Completed',
    description: 'Triggers when a subscription has been successfully renewed.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', renewedAt: new Date().toISOString() },
  },
  {
    key: 'trial.started',
    label: 'Trial Started',
    description: 'Triggers when a trial period begins.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', trialEndsAt: new Date().toISOString() },
  },
  {
    key: 'trial.ending',
    label: 'Trial Ending Soon',
    description: 'Triggers 3 days before a trial ends.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', trialEndsAt: new Date().toISOString() },
  },
  {
    key: 'trial.ended',
    label: 'Trial Ended',
    description: 'Triggers when a trial period expires.',
    samplePayload: { id: 'sub_sample', userId: 'usr_sample', name: 'Pro Plan', trialEndedAt: new Date().toISOString() },
  },
];

// ── Action catalog ─────────────────────────────────────────────────────────────

export const ZAPIER_ACTION_DEFINITIONS: ZapierActionDefinition[] = [
  {
    key: 'create_subscription',
    label: 'Create Subscription',
    description: 'Creates a new subscription for a customer.',
    inputFields: [
      { key: 'userId', label: 'User ID', type: 'string', required: true },
      { key: 'planId', label: 'Plan ID', type: 'string', required: true },
      { key: 'startDate', label: 'Start Date', type: 'datetime', required: false },
    ],
  },
  {
    key: 'cancel_subscription',
    label: 'Cancel Subscription',
    description: 'Cancels an active subscription.',
    inputFields: [
      { key: 'subscriptionId', label: 'Subscription ID', type: 'string', required: true },
      { key: 'reason', label: 'Cancellation Reason', type: 'string', required: false },
    ],
  },
  {
    key: 'pause_subscription',
    label: 'Pause Subscription',
    description: 'Pauses billing on an active subscription.',
    inputFields: [
      { key: 'subscriptionId', label: 'Subscription ID', type: 'string', required: true },
      { key: 'pauseDurationDays', label: 'Pause Duration (Days)', type: 'number', required: false },
    ],
  },
  {
    key: 'resume_subscription',
    label: 'Resume Subscription',
    description: 'Resumes a paused subscription.',
    inputFields: [
      { key: 'subscriptionId', label: 'Subscription ID', type: 'string', required: true },
    ],
  },
  {
    key: 'create_invoice',
    label: 'Create Invoice',
    description: 'Manually generates an invoice for a subscription.',
    inputFields: [
      { key: 'subscriptionId', label: 'Subscription ID', type: 'string', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: false, helpText: 'Leave blank to use subscription amount.' },
      { key: 'dueDate', label: 'Due Date', type: 'datetime', required: false },
    ],
  },
  {
    key: 'send_notification',
    label: 'Send Notification',
    description: 'Sends a notification to a subscriber.',
    inputFields: [
      { key: 'userId', label: 'User ID', type: 'string', required: true },
      { key: 'title', label: 'Title', type: 'string', required: true },
      { key: 'message', label: 'Message', type: 'string', required: true },
    ],
  },
];

// ── Service ───────────────────────────────────────────────────────────────────

export class ZapierIntegrationService {
  private hooks = new Map<string, ZapierHookSubscription>();
  private apiKeys = new Map<string, string>(); // apiKey → merchantId

  // ── API Key Management ────────────────────────────────────────────────────

  /**
   * Register a merchant API key for Zapier authentication.
   * In production, API keys are stored in the database and hashed.
   */
  registerApiKey(merchantId: string, apiKey: string): void {
    this.apiKeys.set(apiKey, merchantId);
  }

  validateApiKey(apiKey: string): string | null {
    return this.apiKeys.get(apiKey) ?? null;
  }

  // ── Hook Subscription Management ──────────────────────────────────────────

  registerHook(input: RegisterHookInput): ZapierHookSubscription {
    const id = this.generateId('zhook');
    const now = new Date().toISOString();
    const hook: ZapierHookSubscription = {
      id,
      merchantId: input.merchantId,
      targetUrl: input.targetUrl,
      event: input.event,
      signingSecret: this.generateSigningSecret(),
      active: true,
      createdAt: now,
      updatedAt: now,
      failureCount: 0,
    };
    this.hooks.set(id, hook);
    return hook;
  }

  unregisterHook(hookId: string, merchantId: string): boolean {
    const hook = this.hooks.get(hookId);
    if (!hook || hook.merchantId !== merchantId) return false;
    this.hooks.delete(hookId);
    return true;
  }

  listHooks(merchantId: string): ZapierHookSubscription[] {
    return Array.from(this.hooks.values()).filter(h => h.merchantId === merchantId);
  }

  getHook(hookId: string): ZapierHookSubscription | undefined {
    return this.hooks.get(hookId);
  }

  // ── Trigger Firing ────────────────────────────────────────────────────────

  /**
   * Fire an event to all registered Zapier hooks for a given merchant and event type.
   * Each delivery includes an HMAC-SHA256 signature for Zapier to verify authenticity.
   */
  async fireEvent(
    merchantId: string,
    event: ZapierTriggerEvent,
    data: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
  ): Promise<ZapierFireEventResult[]> {
    const matchingHooks = Array.from(this.hooks.values()).filter(
      h => h.merchantId === merchantId && h.event === event && h.active,
    );

    const results: ZapierFireEventResult[] = [];

    for (const hook of matchingHooks) {
      const result = await this.deliverToHook(hook, event, data, fetchImpl);
      results.push(result);

      // Update hook state
      const updated: ZapierHookSubscription = {
        ...hook,
        lastFiredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        failureCount: result.success ? 0 : hook.failureCount + 1,
        // Auto-disable after 10 consecutive failures to match Zapier behaviour
        active: hook.failureCount + (result.success ? 0 : 1) < 10,
      };
      this.hooks.set(hook.id, updated);
    }

    return results;
  }

  private async deliverToHook(
    hook: ZapierHookSubscription,
    event: ZapierTriggerEvent,
    data: Record<string, unknown>,
    fetchImpl: typeof fetch,
  ): Promise<ZapierFireEventResult> {
    const payload: ZapierWebhookPayload = {
      id: this.generateId('zpevt'),
      event,
      merchantId: hook.merchantId,
      occurredAt: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);
    const signature = this.signPayload(body, hook.signingSecret);

    try {
      const response = await fetchImpl(hook.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SubTrackr-Zapier-Signature': signature,
          'X-SubTrackr-Event': event,
          'X-SubTrackr-Hook-Id': hook.id,
        },
        body,
      });

      return {
        hookId: hook.id,
        success: response.ok,
        statusCode: response.status,
        payload,
      };
    } catch (err) {
      return {
        hookId: hook.id,
        success: false,
        error: err instanceof Error ? err.message : 'Delivery failed',
        payload,
      };
    }
  }

  // ── Action Handler ────────────────────────────────────────────────────────

  /**
   * Handle an inbound action from Zapier.
   * The actual domain logic is delegated to action handlers injected via
   * `registerActionHandler`. This keeps the Zapier layer thin and testable.
   */
  handleAction(input: ZapierActionPayload): ZapierActionResult {
    const handler = this.actionHandlers.get(input.action);
    if (!handler) {
      return { success: false, error: `Unsupported action: ${input.action}` };
    }
    try {
      return handler(input.merchantId, input.params);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Action failed' };
    }
  }

  private actionHandlers = new Map<
    ZapierActionType,
    (merchantId: string, params: Record<string, unknown>) => ZapierActionResult
  >();

  registerActionHandler(
    action: ZapierActionType,
    handler: (merchantId: string, params: Record<string, unknown>) => ZapierActionResult,
  ): void {
    this.actionHandlers.set(action, handler);
  }

  // ── Search Handler ────────────────────────────────────────────────────────

  handleSearch(params: ZapierSearchParams): ZapierSearchResult {
    const handler = this.searchHandlers.get(params.searchType);
    if (!handler) {
      return { success: false, results: [], count: 0 };
    }
    return handler(params.merchantId, params.query);
  }

  private searchHandlers = new Map<
    ZapierSearchType,
    (merchantId: string, query: Record<string, unknown>) => ZapierSearchResult
  >();

  registerSearchHandler(
    searchType: ZapierSearchType,
    handler: (merchantId: string, query: Record<string, unknown>) => ZapierSearchResult,
  ): void {
    this.searchHandlers.set(searchType, handler);
  }

  // ── Catalog ───────────────────────────────────────────────────────────────

  getTriggerDefinitions(): ZapierTriggerDefinition[] {
    return ZAPIER_TRIGGER_DEFINITIONS;
  }

  getActionDefinitions(): ZapierActionDefinition[] {
    return ZAPIER_ACTION_DEFINITIONS;
  }

  // ── Payload Signing ───────────────────────────────────────────────────────

  /**
   * Sign a payload for delivery to Zapier.
   * Zapier can verify this using HMAC-SHA256 with the shared signing secret.
   */
  signPayload(body: string, signingSecret: string): string {
    return crypto.createHmac('sha256', signingSecret).update(body).digest('hex');
  }

  /**
   * Verify a payload received from Zapier (for inbound actions/searches).
   */
  verifyInboundSignature(body: string, signature: string, signingSecret: string): boolean {
    const expected = this.signPayload(body, signingSecret);
    const actualBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  }

  private generateSigningSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

export interface ZapierFireEventResult {
  hookId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  payload: ZapierWebhookPayload;
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const zapierIntegrationService = new ZapierIntegrationService();
