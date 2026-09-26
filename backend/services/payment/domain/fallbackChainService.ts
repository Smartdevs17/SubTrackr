/**
 * Issue #773 – Subscription Payment Method Fallback Chains
 *
 * Provides:
 *   - Fallback chain configuration per merchant
 *   - Automatic fallback on gateway failure
 *   - Fallback analytics and history
 *   - Fallback notifications
 *   - Fallback API
 */

import { logger } from '../../shared/logging';

// ── Types ────────────────────────────────────────────────────────────────────

export type GatewayName = 'stripe' | 'circle' | 'stellar';

export type FallbackStatus = 'success' | 'failed' | 'timeout' | 'skipped';

export interface FallbackChainEntry {
  /** Gateway identifier */
  gateway: GatewayName;
  /** Priority (lower = tried first) */
  priority: number;
  /** Whether this entry is enabled */
  enabled: boolean;
  /** Timeout in milliseconds for this gateway */
  timeoutMs: number;
}

export interface FallbackChain {
  /** Unique chain identifier */
  id: string;
  /** Merchant this chain belongs to */
  merchantId: string;
  /** Ordered list of gateways to try */
  chain: FallbackChainEntry[];
  /** Number of retry attempts per gateway */
  retryAttempts: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  /** Whether this chain is active */
  active: boolean;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

export interface FallbackAttempt {
  /** Unique attempt identifier */
  id: string;
  /** Chain identifier */
  chainId: string;
  /** Merchant identifier */
  merchantId: string;
  /** Gateway that was attempted */
  gateway: GatewayName;
  /** Priority of this gateway in the chain */
  priority: number;
  /** Attempt status */
  status: FallbackStatus;
  /** Error message if failed */
  error?: string;
  /** Duration of the attempt in milliseconds */
  durationMs: number;
  /** Payment amount */
  amount: number;
  /** Payment currency */
  currency: string;
  /** Customer identifier */
  customerId: string;
  /** ISO timestamp of attempt */
  timestamp: string;
  /** Whether this was a retry attempt */
  isRetry: boolean;
  /** Retry attempt number (0 = initial) */
  retryNumber: number;
}

export interface FallbackResult {
  /** Whether the payment succeeded */
  success: boolean;
  /** Gateway that succeeded (if any) */
  successfulGateway?: GatewayName;
  /** All attempts made */
  attempts: FallbackAttempt[];
  /** Total duration of all attempts */
  totalDurationMs: number;
  /** Final error if all gateways failed */
  error?: string;
}

export interface FallbackAnalytics {
  /** Total fallback attempts */
  totalAttempts: number;
  /** Successful attempts */
  successfulAttempts: number;
  /** Failed attempts */
  failedAttempts: number;
  /** Timeout attempts */
  timeoutAttempts: number;
  /** Success rate by gateway */
  successRateByGateway: Record<GatewayName, number>;
  /** Average attempts per payment */
  averageAttemptsPerPayment: number;
  /** Average total fallback duration */
  averageTotalDurationMs: number;
  /** Most common failure reasons */
  commonFailureReasons: Array<{ reason: string; count: number }>;
  /** Fallback rate (percentage of payments that needed fallback) */
  fallbackRate: number;
  /** Period start */
  periodStart: string;
  /** Period end */
  periodEnd: string;
}

export interface FallbackNotification {
  /** Notification identifier */
  id: string;
  /** Merchant identifier */
  merchantId: string;
  /** Notification type */
  type: 'fallback_triggered' | 'fallback_succeeded' | 'fallback_failed' | 'chain_disabled';
  /** Notification title */
  title: string;
  /** Notification message */
  message: string;
  /** Related payment attempt IDs */
  attemptIds: string[];
  /** ISO timestamp */
  timestamp: string;
  /** Whether notification has been sent */
  sent: boolean;
}

// ── Store (in-memory; replace with DB in production) ─────────────────────────

const chains = new Map<string, FallbackChain>();
const attempts: FallbackAttempt[] = [];
const notifications: FallbackNotification[] = [];

// ── Chain Management ─────────────────────────────────────────────────────────

/**
 * Create or update a fallback chain for a merchant.
 */
export function upsertFallbackChain(
  merchantId: string,
  config: Omit<FallbackChain, 'id' | 'merchantId' | 'createdAt' | 'updatedAt'>
): FallbackChain {
  const existing = Array.from(chains.values()).find((c) => c.merchantId === merchantId);

  const now = new Date().toISOString();
  const chain: FallbackChain = {
    id: existing?.id ?? `chain-${merchantId}-${Date.now()}`,
    merchantId,
    ...config,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  chains.set(chain.id, chain);
  return chain;
}

/**
 * Get the fallback chain for a merchant.
 */
export function getFallbackChain(merchantId: string): FallbackChain | undefined {
  return Array.from(chains.values()).find((c) => c.merchantId === merchantId && c.active);
}

/**
 * Get all fallback chains.
 */
export function getAllFallbackChains(): FallbackChain[] {
  return Array.from(chains.values());
}

/**
 * Delete a fallback chain.
 */
export function deleteFallbackChain(merchantId: string): boolean {
  const chain = Array.from(chains.values()).find((c) => c.merchantId === merchantId);
  if (!chain) return false;
  chains.delete(chain.id);
  return true;
}

/**
 * Disable a fallback chain.
 */
export function disableFallbackChain(merchantId: string): boolean {
  const chain = Array.from(chains.values()).find((c) => c.merchantId === merchantId);
  if (!chain) return false;
  chain.active = false;
  chain.updatedAt = new Date().toISOString();
  return true;
}

// ── Gateway Execution ────────────────────────────────────────────────────────

type GatewayExecutor = (
  request: { amount: number; currency: string; customerId: string; paymentMethodId: string }
) => Promise<{ success: boolean; error?: string; gatewayUsed?: string }>;

const gatewayExecutors = new Map<GatewayName, GatewayExecutor>();

/**
 * Register a gateway executor function.
 */
export function registerGatewayExecutor(
  gateway: GatewayName,
  executor: GatewayExecutor
): void {
  gatewayExecutors.set(gateway, executor);
}

// ── Fallback Execution ───────────────────────────────────────────────────────

/**
 * Execute a payment with automatic fallback through the chain.
 */
export async function executeWithFallback(
  merchantId: string,
  request: {
    amount: number;
    currency: string;
    customerId: string;
    paymentMethodId: string;
  }
): Promise<FallbackResult> {
  const chain = getFallbackChain(merchantId);

  // Default chain if none configured
  const entries: FallbackChainEntry[] = chain?.chain ?? [
    { gateway: 'stripe', priority: 0, enabled: true, timeoutMs: 5000 },
    { gateway: 'circle', priority: 1, enabled: true, timeoutMs: 5000 },
    { gateway: 'stellar', priority: 2, enabled: true, timeoutMs: 5000 },
  ];

  const retryAttempts = chain?.retryAttempts ?? 1;
  const retryDelayMs = chain?.retryDelayMs ?? 1000;

  const sortedEntries = [...entries]
    .filter((e) => e.enabled)
    .sort((a, b) => a.priority - b.priority);

  const allAttempts: FallbackAttempt[] = [];
  const startTime = Date.now();

  for (const entry of sortedEntries) {
    const executor = gatewayExecutors.get(entry.gateway);
    if (!executor) {
      logger.warn('No executor registered for gateway', { gateway: entry.gateway });
      continue;
    }

    for (let retry = 0; retry <= retryAttempts; retry++) {
      const attemptStart = Date.now();
      const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isRetry = retry > 0;

      try {
        // Add timeout wrapper
        const result = await Promise.race([
          executor(request),
          new Promise<{ success: false; error: string }>((resolve) =>
            setTimeout(
              () => resolve({ success: false, error: `Gateway timeout after ${entry.timeoutMs}ms` }),
              entry.timeoutMs
            )
          ),
        ]);

        const durationMs = Date.now() - attemptStart;
        const status: FallbackStatus = result.success ? 'success' : 'failed';

        const attempt: FallbackAttempt = {
          id: attemptId,
          chainId: chain?.id ?? 'default',
          merchantId,
          gateway: entry.gateway,
          priority: entry.priority,
          status,
          error: result.error,
          durationMs,
          amount: request.amount,
          currency: request.currency,
          customerId: request.customerId,
          timestamp: new Date().toISOString(),
          isRetry,
          retryNumber: retry,
        };

        allAttempts.push(attempt);
        attempts.push(attempt);

        if (result.success) {
          // Notify success
          if (isRetry) {
            createNotification(merchantId, 'fallback_succeeded', `Payment succeeded on ${entry.gateway} after ${retry} retries`, [attemptId]);
          }

          return {
            success: true,
            successfulGateway: entry.gateway,
            attempts: allAttempts,
            totalDurationMs: Date.now() - startTime,
          };
        }

        // Log failure
        logger.warn('Gateway failed in fallback chain', {
          gateway: entry.gateway,
          retry,
          error: result.error,
        });

      } catch (err) {
        const durationMs = Date.now() - attemptStart;
        const error = err instanceof Error ? err.message : String(err);

        const attempt: FallbackAttempt = {
          id: attemptId,
          chainId: chain?.id ?? 'default',
          merchantId,
          gateway: entry.gateway,
          priority: entry.priority,
          status: error.includes('timeout') ? 'timeout' : 'failed',
          error,
          durationMs,
          amount: request.amount,
          currency: request.currency,
          customerId: request.customerId,
          timestamp: new Date().toISOString(),
          isRetry,
          retryNumber: retry,
        };

        allAttempts.push(attempt);
        attempts.push(attempt);

        logger.warn('Gateway error in fallback chain', {
          gateway: entry.gateway,
          retry,
          error,
        });
      }

      // Delay before retry
      if (retry < retryAttempts) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  // All gateways failed
  const error = `All gateways failed: ${allAttempts.map((a) => `${a.gateway}: ${a.error}`).join('; ')}`;

  createNotification(
    merchantId,
    'fallback_failed',
    `Payment failed after trying ${allAttempts.length} gateway attempts`,
    allAttempts.map((a) => a.id)
  );

  return {
    success: false,
    attempts: allAttempts,
    totalDurationMs: Date.now() - startTime,
    error,
  };
}

// ── Notifications ────────────────────────────────────────────────────────────

function createNotification(
  merchantId: string,
  type: FallbackNotification['type'],
  message: string,
  attemptIds: string[]
): FallbackNotification {
  const titles: Record<FallbackNotification['type'], string> = {
    fallback_triggered: 'Payment Fallback Triggered',
    fallback_succeeded: 'Fallback Payment Succeeded',
    fallback_failed: 'All Payment Gateways Failed',
    chain_disabled: 'Fallback Chain Disabled',
  };

  const notification: FallbackNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    merchantId,
    type,
    title: titles[type],
    message,
    attemptIds,
    timestamp: new Date().toISOString(),
    sent: false,
  };

  notifications.push(notification);
  return notification;
}

/**
 * Get notifications for a merchant.
 */
export function getNotifications(
  merchantId: string,
  options: { limit?: number; unsentOnly?: boolean } = {}
): FallbackNotification[] {
  const { limit = 50, unsentOnly = false } = options;

  let filtered = notifications.filter((n) => n.merchantId === merchantId);
  if (unsentOnly) filtered = filtered.filter((n) => !n.sent);

  return filtered.slice(-limit);
}

/**
 * Mark a notification as sent.
 */
export function markNotificationSent(notificationId: string): boolean {
  const notification = notifications.find((n) => n.id === notificationId);
  if (!notification) return false;
  notification.sent = true;
  return true;
}

// ── History ──────────────────────────────────────────────────────────────────

/**
 * Get fallback attempt history.
 */
export function getFallbackHistory(options: {
  merchantId?: string;
  gateway?: GatewayName;
  status?: FallbackStatus;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
} = {}): FallbackAttempt[] {
  const { merchantId, gateway, status, limit = 100, offset = 0, startDate, endDate } = options;

  let filtered = [...attempts];

  if (merchantId) filtered = filtered.filter((a) => a.merchantId === merchantId);
  if (gateway) filtered = filtered.filter((a) => a.gateway === gateway);
  if (status) filtered = filtered.filter((a) => a.status === status);
  if (startDate) filtered = filtered.filter((a) => a.timestamp >= startDate);
  if (endDate) filtered = filtered.filter((a) => a.timestamp <= endDate);

  return filtered.slice(offset, offset + limit);
}

// ── Analytics ────────────────────────────────────────────────────────────────

/**
 * Get fallback analytics for a time period.
 */
export function getFallbackAnalytics(options: {
  startDate?: string;
  endDate?: string;
  merchantId?: string;
} = {}): FallbackAnalytics {
  const { startDate, endDate, merchantId } = options;

  let filtered = [...attempts];

  if (merchantId) filtered = filtered.filter((a) => a.merchantId === merchantId);
  if (startDate) filtered = filtered.filter((a) => a.timestamp >= startDate);
  if (endDate) filtered = filtered.filter((a) => a.timestamp <= endDate);

  const totalAttempts = filtered.length;
  const successfulAttempts = filtered.filter((a) => a.status === 'success').length;
  const failedAttempts = filtered.filter((a) => a.status === 'failed').length;
  const timeoutAttempts = filtered.filter((a) => a.status === 'timeout').length;

  // Success rate by gateway
  const successRateByGateway: Record<GatewayName, number> = {
    stripe: 0,
    circle: 0,
    stellar: 0,
  };

  for (const gateway of Object.keys(successRateByGateway) as GatewayName[]) {
    const gatewayAttempts = filtered.filter((a) => a.gateway === gateway);
    const gatewaySuccess = gatewayAttempts.filter((a) => a.status === 'success').length;
    successRateByGateway[gateway] = gatewayAttempts.length > 0
      ? gatewaySuccess / gatewayAttempts.length
      : 0;
  }

  // Average attempts per unique payment (group by customerId + timestamp)
  const uniquePayments = new Set(filtered.map((a) => `${a.customerId}-${a.amount}-${a.currency}`));
  const averageAttemptsPerPayment = uniquePayments.size > 0
    ? totalAttempts / uniquePayments.size
    : 0;

  // Average total duration
  const totalDurations = new Map<string, number>();
  for (const a of filtered) {
    const key = `${a.customerId}-${a.amount}-${a.currency}`;
    totalDurations.set(key, (totalDurations.get(key) ?? 0) + a.durationMs);
  }
  const averageTotalDurationMs = totalDurations.size > 0
    ? Array.from(totalDurations.values()).reduce((a, b) => a + b, 0) / totalDurations.size
    : 0;

  // Common failure reasons
  const failureReasons = new Map<string, number>();
  for (const a of filtered.filter((a) => a.status !== 'success' && a.error)) {
    const reason = a.error!.slice(0, 100);
    failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
  }
  const commonFailureReasons = Array.from(failureReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Fallback rate
  const paymentsNeedingFallback = uniquePayments.size;
  const totalPayments = new Set(
    filtered.filter((a) => a.status === 'success').map((a) => `${a.customerId}-${a.amount}-${a.currency}`)
  ).size;
  const fallbackRate = totalPayments > 0
    ? (paymentsNeedingFallback - totalPayments) / paymentsNeedingFallback
    : 0;

  return {
    totalAttempts,
    successfulAttempts,
    failedAttempts,
    timeoutAttempts,
    successRateByGateway,
    averageAttemptsPerPayment,
    averageTotalDurationMs,
    commonFailureReasons,
    fallbackRate,
    periodStart: filtered.length > 0 ? filtered[0].timestamp : new Date().toISOString(),
    periodEnd: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : new Date().toISOString(),
  };
}

/**
 * Reset analytics (for testing).
 */
export function resetFallbackAnalytics(): void {
  attempts.length = 0;
  notifications.length = 0;
}
