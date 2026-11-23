/**
 * Typed client for the administrator subscription console API (Issue #2199).
 *
 * Keeps the React Native console decoupled from the backend service while
 * preserving the standard `{ success, data }` REST envelope.
 */

import { apiClient } from './network/apiClient';

export type ManagedSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'paused'
  | 'past_due'
  | 'canceled';

export interface ManagedSubscription {
  id: string;
  ownerId: string;
  planId: string;
  status: ManagedSubscriptionStatus;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  cancelReason?: string;
}

export interface SubscriptionConsoleFilter {
  status?: ManagedSubscriptionStatus;
  ownerId?: string;
  planId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SubscriptionConsolePage {
  items: ManagedSubscription[];
  total: number;
  limit: number;
  offset: number;
}

export interface SubscriptionConsoleSummary {
  total: number;
  byStatus: Record<ManagedSubscriptionStatus, number>;
  monthlyRecurringRevenue: number;
  currency: string;
}

export interface ConsoleAuditRecord {
  id: string;
  actorId: string;
  action: string;
  subscriptionId: string;
  reason?: string;
  at: string;
}

export interface BulkPauseResult {
  requested: string[];
  succeeded: string[];
  failed: Array<{ id: string; code: string; message: string }>;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface SubscriptionConsoleTransport {
  request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<{ data: T }>;
}

function queryString(filter: SubscriptionConsoleFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export class SubscriptionConsoleClient {
  constructor(
    private readonly transport: SubscriptionConsoleTransport = apiClient,
    private readonly basePath = '/admin/subscriptions'
  ) {}

  list(filter: SubscriptionConsoleFilter = {}): Promise<SubscriptionConsolePage> {
    return this.unwrap<SubscriptionConsolePage>(`${this.basePath}${queryString(filter)}`);
  }

  get(id: string): Promise<ManagedSubscription> {
    return this.unwrap<ManagedSubscription>(`${this.basePath}/${encodeURIComponent(id)}`);
  }

  summary(): Promise<SubscriptionConsoleSummary> {
    return this.unwrap<SubscriptionConsoleSummary>(`${this.basePath}/summary`);
  }

  audit(subscriptionId?: string): Promise<ConsoleAuditRecord[]> {
    const query = subscriptionId ? `?subscriptionId=${encodeURIComponent(subscriptionId)}` : '';
    return this.unwrap<ConsoleAuditRecord[]>(`${this.basePath}/audit${query}`);
  }

  pause(id: string, reason: string): Promise<ManagedSubscription> {
    return this.mutate<ManagedSubscription>(`${this.basePath}/${encodeURIComponent(id)}/pause`, {
      reason,
    });
  }

  resume(id: string): Promise<ManagedSubscription> {
    return this.mutate<ManagedSubscription>(`${this.basePath}/${encodeURIComponent(id)}/resume`);
  }

  cancel(id: string, reason: string): Promise<ManagedSubscription> {
    return this.mutate<ManagedSubscription>(`${this.basePath}/${encodeURIComponent(id)}/cancel`, {
      reason,
    });
  }

  changePlan(id: string, planId: string): Promise<ManagedSubscription> {
    return this.request<ManagedSubscription>(
      `${this.basePath}/${encodeURIComponent(id)}/plan`,
      'PATCH',
      { planId }
    );
  }

  bulkPause(ids: string[], reason: string): Promise<BulkPauseResult> {
    return this.mutate<BulkPauseResult>(`${this.basePath}/bulk-pause`, { ids, reason });
  }

  private mutate<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, 'POST', body);
  }

  private async request<T>(
    path: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.transport.request<Envelope<T>>(path, { method, body });
    const envelope = response.data;
    if (!envelope?.success) {
      throw new Error(`Subscription console request failed: ${method} ${path}`);
    }
    return envelope.data;
  }

  private unwrap<T>(path: string): Promise<T> {
    return this.request<T>(path, 'GET');
  }
}

export const subscriptionConsoleClient = new SubscriptionConsoleClient();
