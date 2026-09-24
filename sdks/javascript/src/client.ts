/**
 * client.ts
 *
 * Issue #1178 — Implement SDK versioning with deprecation policy
 *
 * Extends the existing SubTrackrClient with:
 *  - SDK version stamped on every request (X-SDK-Version header)
 *  - Configurable target API version (X-API-Version header)
 *  - Runtime validation of the requested API version against supported range
 *  - Response-version checking: warns when server replies with a deprecated
 *    or newer API version
 *  - Deprecated method wrappers so old call sites get one-time console.warns
 *    before they break in a future major release
 *  - Full backwards-compatibility: existing constructors work unchanged
 */

import {
  CreatePlanRequest,
  InitializeRequest,
  Plan,
  PlanIdRequest,
  RequestRefundRequest,
  SDKOptions,
  SubscriberRequest,
  SubscriberSubscriptionRequest,
  Subscription,
  SubscriptionIdRequest,
  Webhook,
} from './types';
import { AuthManager } from './auth';
import { ApiError, UnsupportedVersionError, VersionMismatchError } from './errors';
import {
  SDK_VERSION,
  CURRENT_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  assessApiVersionCompatibility,
} from './version';
import { warnDeprecated, DeprecationRegistry } from './deprecation';

// ── Header names ──────────────────────────────────────────────────────────────

const SDK_VERSION_HEADER = 'X-SDK-Version';
const API_VERSION_HEADER = 'X-API-Version';
const REQUEST_ID_HEADER = 'X-Request-ID';

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── SubTrackrClient ───────────────────────────────────────────────────────────

export class SubTrackrClient {
  private authManager: AuthManager;
  private baseUrl: string;
  /** Resolved API version this instance targets. */
  readonly apiVersion: number;
  /** Whether to emit deprecation/version warnings. */
  private readonly warnOnDeprecation: boolean;

  constructor(options: SDKOptions) {
    // Validate the requested API version before doing anything else
    const requested = options.apiVersion ?? CURRENT_API_VERSION;
    if (requested < MIN_SUPPORTED_API_VERSION) {
      throw new UnsupportedVersionError(requested, MIN_SUPPORTED_API_VERSION);
    }
    const compat = assessApiVersionCompatibility(requested);
    if (compat.removed) {
      throw new UnsupportedVersionError(requested, MIN_SUPPORTED_API_VERSION);
    }

    this.apiVersion = requested;
    this.warnOnDeprecation = options.warnOnDeprecation !== false;

    if (this.warnOnDeprecation && compat.deprecated && compat.message) {
      // eslint-disable-next-line no-console
      console.warn(`[SubTrackr SDK v${SDK_VERSION}] ${compat.message}`);
    }

    this.authManager = new AuthManager(options);
    this.baseUrl =
      options.baseUrl ||
      (options.environment === 'sandbox'
        ? 'https://sandbox.api.subtrackr.app'
        : 'https://api.subtrackr.app');
  }

  // ── Core HTTP ─────────────────────────────────────────────────────────────

  private async request<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    const token = await this.authManager.getToken();
    const url = `${this.baseUrl}${endpoint}`;
    const requestId = generateRequestId();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [SDK_VERSION_HEADER]: SDK_VERSION,
      [API_VERSION_HEADER]: String(this.apiVersion),
      [REQUEST_ID_HEADER]: requestId,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Check the API version the server reports back
    this._checkResponseVersion(response);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(
        errorData.message || 'API request failed',
        response.status,
        errorData.code
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Inspect the X-API-Version response header and warn/throw as appropriate.
   * Called on every response from the server.
   */
  private _checkResponseVersion(response: Response): void {
    if (!this.warnOnDeprecation) return;
    const headerValue = response.headers.get(API_VERSION_HEADER);
    if (!headerValue) return;

    const serverVersion = parseInt(headerValue, 10);
    if (Number.isNaN(serverVersion)) return;

    const compat = assessApiVersionCompatibility(serverVersion);

    if (compat.removed || (!compat.supported && !compat.deprecated)) {
      // Server returned a version the SDK cannot handle — throw to alert the developer
      throw new VersionMismatchError(SDK_VERSION, serverVersion, compat.message);
    }

    if (compat.deprecated && compat.message) {
      // Warn once (the deprecation registry deduplicates across calls)
      const key = `response_api_version_${serverVersion}`;
      if (!DeprecationRegistry.hasWarned(key)) {
        DeprecationRegistry.markWarned(key);
        if (!DeprecationRegistry.silenced) {
          // eslint-disable-next-line no-console
          console.warn(`[SubTrackr SDK v${SDK_VERSION}] ${compat.message}`);
        }
      }
    }
  }

  // ── SDK version introspection ─────────────────────────────────────────────

  /** Returns the SDK semantic version string, e.g. "2.0.0". */
  getSdkVersion(): string {
    return SDK_VERSION;
  }

  /** Returns the API version this client instance is configured to use. */
  getApiVersion(): number {
    return this.apiVersion;
  }

  // ── Contract APIs (current) ───────────────────────────────────────────────

  async initialize(data: InitializeRequest): Promise<void> {
    return this.request<void>('/initialize', 'POST', data);
  }

  async createPlan(data: CreatePlanRequest): Promise<number> {
    return this.request<number>('/create_plan', 'POST', data);
  }

  async deactivatePlan(data: PlanIdRequest & { merchant: string }): Promise<void> {
    return this.request<void>('/deactivate_plan', 'POST', data);
  }

  async subscribe(data: { subscriber: string; plan_id: number }): Promise<number> {
    return this.request<number>('/subscribe', 'POST', data);
  }

  async cancelSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/cancel_subscription', 'POST', data);
  }

  async pauseSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/pause_subscription', 'POST', data);
  }

  async resumeSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/resume_subscription', 'POST', data);
  }

  async chargeSubscription(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/charge_subscription', 'POST', data);
  }

  async requestRefund(data: RequestRefundRequest): Promise<void> {
    return this.request<void>('/request_refund', 'POST', data);
  }

  async approveRefund(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/approve_refund', 'POST', data);
  }

  async rejectRefund(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/reject_refund', 'POST', data);
  }

  async getPlan(data: PlanIdRequest): Promise<Plan> {
    return this.request<Plan>('/get_plan', 'POST', data);
  }

  async getSubscription(data: SubscriptionIdRequest): Promise<Subscription> {
    return this.request<Subscription>('/get_subscription', 'POST', data);
  }

  async getUserSubscriptions(data: SubscriberRequest): Promise<number[]> {
    return this.request<number[]>('/get_user_subscriptions', 'POST', data);
  }

  async getMerchantPlans(data: { merchant: string }): Promise<number[]> {
    return this.request<number[]>('/get_merchant_plans', 'POST', data);
  }

  async getPlanCount(): Promise<number> {
    return this.request<number>('/get_plan_count', 'POST');
  }

  async getSubscriptionCount(): Promise<number> {
    return this.request<number>('/get_subscription_count', 'POST');
  }

  // ── REST APIs (v1 — current) ──────────────────────────────────────────────

  /**
   * Returns a list of subscriptions.
   *
   * @deprecated since SDK v2.0.0, will be removed in v3.0.0.
   *   Use `listSubscriptions()` instead which returns the standard envelope.
   */
  async getSubscriptions(): Promise<Subscription[]> {
    warnDeprecated({
      method: 'getSubscriptions',
      deprecatedIn: '2.0.0',
      removedIn: '3.0.0',
      replacement: 'listSubscriptions()',
      note: 'listSubscriptions() returns a typed envelope with pagination metadata.',
    });
    return this.request<Subscription[]>('/v1/subscriptions');
  }

  /** Current replacement for the deprecated getSubscriptions(). */
  async listSubscriptions(): Promise<Subscription[]> {
    return this.request<Subscription[]>('/v1/subscriptions');
  }

  async createSubscription(data: Omit<Subscription, 'id' | 'status'>): Promise<Subscription> {
    return this.request<Subscription>('/v1/subscriptions', 'POST', data);
  }

  // ── Webhook APIs (current) ────────────────────────────────────────────────

  /**
   * @deprecated since SDK v2.0.0, will be removed in v3.0.0.
   *   Use `listWebhooks()` instead.
   */
  async getWebhooks(): Promise<Webhook[]> {
    warnDeprecated({
      method: 'getWebhooks',
      deprecatedIn: '2.0.0',
      removedIn: '3.0.0',
      replacement: 'listWebhooks()',
    });
    return this.request<Webhook[]>('/v1/webhooks');
  }

  /** Current replacement for the deprecated getWebhooks(). */
  async listWebhooks(): Promise<Webhook[]> {
    return this.request<Webhook[]>('/v1/webhooks');
  }

  async createWebhook(data: Omit<Webhook, 'id'>): Promise<Webhook> {
    return this.request<Webhook>('/v1/webhooks', 'POST', data);
  }
}
