/**
 * backend/src/services/providerStatus.ts
 *
 * Issue #2035 — provider-outage detection with a status banner surface.
 *
 * The webhook-driven cache in `../../services/providerStatus.ts` answers
 * "what did the provider last tell us?". This module answers the different
 * question "are we actually seeing an outage right now?", which cannot be
 * decided from a single status field: one failed charge is noise, five in a
 * row is an incident, and recovery needs repeated successes.
 *
 * It is deliberately source-agnostic. It can be fed from the existing status
 * cache via `refresh()` / `ingestStatus()`, or directly from gateway failures
 * via `recordFailure()` / `recordSuccess()`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderSignalStatus =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown';

export type OutageStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface ProviderStatusSignal {
  providerId: string;
  status: ProviderSignalStatus;
  description?: string;
  updatedAt?: string | number;
}

export interface ProviderOutageSnapshot {
  providerId: string;
  status: OutageStatus;
  consecutiveFailures: number;
  failureRate: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  reason?: string;
  detectedAt?: string;
  recoveredAt?: string;
  updatedAt: string;
}

export interface ProviderStatusSnapshot {
  overall: OutageStatus;
  providers: ProviderOutageSnapshot[];
  activeOutages: string[];
  updatedAt: string;
}

export interface ProviderOutageMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

export interface ProviderOutageOptions {
  /** Providers tracked even before their first event. */
  providers?: string[];
  /** Optional webhook-cache adapter (only `getAllStatuses` is required). */
  source?: { getAllStatuses(): ProviderStatusSignal[] };
  /** Rolling window for failure-rate calculation. Default 5 minutes. */
  windowMs?: number;
  /** Consecutive failures that constitute an outage. Default 3. */
  failureThreshold?: number;
  /** Failure rate that constitutes degradation. Default 0.34. */
  degradedFailureRate?: number;
  /** Minimum samples before the failure rate is trusted. Default 3. */
  minSamplesForDegraded?: number;
  /** Consecutive successes required to clear an outage. Default 2. */
  recoveryThreshold?: number;
  /** Minimum time between two status transitions. Default 1000 ms. */
  transitionDebounceMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  metrics?: ProviderOutageMetrics;
  now?: () => number;
}

export type OutageListener = (
  snapshot: ProviderStatusSnapshot,
  previous: ProviderStatusSnapshot,
) => void;

export interface ProviderOutageMonitor {
  recordFailure(providerId: string, reason?: string): ProviderOutageSnapshot;
  recordSuccess(providerId: string): ProviderOutageSnapshot;
  ingestStatus(signal: ProviderStatusSignal): ProviderOutageSnapshot;
  refresh(): ProviderStatusSnapshot;
  getStatus(providerId: string): ProviderOutageSnapshot | undefined;
  getSnapshot(): ProviderStatusSnapshot;
  subscribe(listener: OutageListener): () => void;
  reset(providerId?: string): void;
}

// ── Internals ─────────────────────────────────────────────────────────────────

interface OutcomeEvent {
  at: number;
  ok: boolean;
}

interface ProviderState {
  events: OutcomeEvent[];
  status: OutageStatus;
  reportedStatus?: OutageStatus;
  reason?: string;
  detectedAt?: number;
  recoveredAt?: number;
  lastTransitionAt: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
}

const DEFAULT_OPTIONS = {
  windowMs: 5 * 60 * 1000,
  failureThreshold: 3,
  degradedFailureRate: 0.34,
  minSamplesForDegraded: 3,
  recoveryThreshold: 2,
  transitionDebounceMs: 1000,
};

export const noopOutageMetrics: ProviderOutageMetrics = {
  increment: () => undefined,
  gauge: () => undefined,
};

function toIso(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function severity(status: OutageStatus): number {
  switch (status) {
    case 'outage':
      return 3;
    case 'degraded':
      return 2;
    case 'unknown':
      return 1;
    default:
      return 0;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createProviderOutageMonitor(
  options: ProviderOutageOptions = {},
): ProviderOutageMonitor {
  const cfg = { ...DEFAULT_OPTIONS, ...options };
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? console;
  const metrics = options.metrics ?? noopOutageMetrics;
  const listeners = new Set<OutageListener>();
  const states = new Map<string, ProviderState>();

  function ensure(providerId: string): ProviderState {
    let state = states.get(providerId);
    if (!state) {
      state = {
        events: [],
        status: 'unknown',
        lastTransitionAt: Number.NEGATIVE_INFINITY,
      };
      states.set(providerId, state);
    }
    return state;
  }

  function prune(state: ProviderState): void {
    const cutoff = now() - cfg.windowMs;
    state.events = state.events.filter((event) => event.at >= cutoff);
  }

  function trailingRun(state: ProviderState, ok: boolean): number {
    let count = 0;
    for (let index = state.events.length - 1; index >= 0; index -= 1) {
      if (state.events[index].ok !== ok) break;
      count += 1;
    }
    return count;
  }

  function derive(state: ProviderState): OutageStatus {
    // A degraded webhook signal is meaningful even before any gateway outcome
    // has been recorded, so it must not be hidden behind the "no samples"
    // guard below.
    if (state.events.length === 0) {
      return state.reportedStatus === 'degraded' ? 'degraded' : 'unknown';
    }

    const failures = state.events.filter((event) => !event.ok).length;
    const failureRate = failures / state.events.length;
    const consecutiveFailures = trailingRun(state, false);
    const consecutiveSuccesses = trailingRun(state, true);

    if (state.status === 'outage') {
      if (consecutiveSuccesses < cfg.recoveryThreshold) return 'outage';
      if (failureRate >= cfg.degradedFailureRate) return 'degraded';
      return 'operational';
    }

    if (consecutiveFailures >= cfg.failureThreshold) return 'outage';

    if (state.reportedStatus === 'degraded') return 'degraded';

    if (
      state.events.length >= cfg.minSamplesForDegraded &&
      failureRate >= cfg.degradedFailureRate
    ) {
      return 'degraded';
    }

    return 'operational';
  }

  function failureRateOf(state: ProviderState): number {
    if (state.events.length === 0) return 0;
    return state.events.filter((event) => !event.ok).length / state.events.length;
  }

  function snapshotOf(providerId: string, state: ProviderState): ProviderOutageSnapshot {
    return {
      providerId,
      status: state.status,
      consecutiveFailures: trailingRun(state, false),
      failureRate: Number(failureRateOf(state).toFixed(4)),
      lastFailureAt: toIso(state.lastFailureAt),
      lastSuccessAt: toIso(state.lastSuccessAt),
      reason: state.reason,
      detectedAt: toIso(state.detectedAt),
      recoveredAt: toIso(state.recoveredAt),
      updatedAt: new Date(now()).toISOString(),
    };
  }

  function notify(previous: ProviderStatusSnapshot): void {
    const current = monitor.getSnapshot();
    for (const listener of listeners) {
      try {
        listener(current, previous);
      } catch {
        // A broken subscriber must never break outage detection.
      }
    }
  }

  function apply(providerId: string, ok: boolean, reason?: string): ProviderOutageSnapshot {
    const state = ensure(providerId);
    const previousSnapshot = monitor.getSnapshot();
    const timestamp = now();

    if (ok) state.reportedStatus = undefined;
    state.events.push({ at: timestamp, ok });
    if (ok) {
      state.lastSuccessAt = timestamp;
    } else {
      state.lastFailureAt = timestamp;
      state.reason = reason;
    }
    prune(state);

    const next = derive(state);
    if (next !== state.status && timestamp - state.lastTransitionAt >= cfg.transitionDebounceMs) {
      const previous = state.status;
      state.status = next;
      state.lastTransitionAt = timestamp;
      if (next === 'outage') state.detectedAt = timestamp;
      if (next === 'operational' && previous === 'outage') state.recoveredAt = timestamp;

      logger.warn(`[provider-outage] ${providerId}: ${previous} -> ${next}`, reason ?? '');
      metrics.increment('provider_outage_transition', {
        provider: providerId,
        from: previous,
        to: next,
      });
      notify(previousSnapshot);
    }

    metrics.gauge('provider_failure_rate', failureRateOf(state), { provider: providerId });
    return snapshotOf(providerId, state);
  }

  const monitor: ProviderOutageMonitor = {
    recordFailure(providerId, reason) {
      return apply(providerId, false, reason);
    },

    recordSuccess(providerId) {
      return apply(providerId, true);
    },

    ingestStatus(signal) {
      if (signal.status === 'operational') return apply(signal.providerId, true);
      if (signal.status === 'partial_outage' || signal.status === 'major_outage') {
        return apply(signal.providerId, false, signal.description);
      }
      if (signal.status === 'degraded' || signal.status === 'maintenance') {
        const state = ensure(signal.providerId);
        state.reportedStatus = 'degraded';
        if (signal.description) state.reason = signal.description;
        prune(state);
        const next = derive(state);
        const previousSnapshot = monitor.getSnapshot();
        if (next !== state.status && now() - state.lastTransitionAt >= cfg.transitionDebounceMs) {
          const previous = state.status;
          state.status = next;
          state.lastTransitionAt = now();
          if (next === 'operational' && previous === 'outage') state.recoveredAt = now();
          logger.warn(`[provider-outage] ${signal.providerId}: ${previous} -> ${next}`);
          metrics.increment('provider_outage_transition', {
            provider: signal.providerId,
            from: previous,
            to: next,
          });
          notify(previousSnapshot);
        }
        return snapshotOf(signal.providerId, state);
      }
      return snapshotOf(signal.providerId, ensure(signal.providerId));
    },

    refresh() {
      if (!options.source) return monitor.getSnapshot();
      for (const signal of options.source.getAllStatuses()) monitor.ingestStatus(signal);
      return monitor.getSnapshot();
    },

    getStatus(providerId) {
      const state = states.get(providerId);
      return state ? snapshotOf(providerId, state) : undefined;
    },

    getSnapshot() {
      const providers = Array.from(states.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([providerId, state]) => snapshotOf(providerId, state));
      let overall: OutageStatus = 'operational';
      for (const provider of providers) {
        if (severity(provider.status) > severity(overall)) overall = provider.status;
      }
      if (providers.length === 0) overall = 'unknown';
      return {
        overall,
        providers,
        activeOutages: providers
          .filter((provider) => provider.status === 'outage')
          .map((provider) => provider.providerId),
        updatedAt: new Date(now()).toISOString(),
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reset(providerId) {
      if (providerId) {
        states.delete(providerId);
      } else {
        states.clear();
      }
    },
  };

  for (const providerId of options.providers ?? []) ensure(providerId);
  return monitor;
}

/** Default process-wide monitor. Wire a source with `refresh()` at startup. */
export const providerOutageMonitor = createProviderOutageMonitor({
  providers: ['stripe', 'paypal', 'paddle', 'stellar'],
});

// ── Framework-agnostic HTTP surface ──────────────────────────────────────────

export interface OutageStatusRequest {
  params?: { providerId?: string };
}

export interface OutageStatusResponse {
  json(body: unknown): void;
  status(code: number): { json(body: unknown): void };
}

/** Mountable from Express/Fastify without coupling this module to either. */
export function createProviderStatusHandler(monitor: ProviderOutageMonitor) {
  return {
    getSnapshot(_req: OutageStatusRequest, res: OutageStatusResponse): void {
      res.json(monitor.getSnapshot());
    },
    getProvider(req: OutageStatusRequest, res: OutageStatusResponse): void {
      const providerId = req.params?.providerId;
      const snapshot = providerId ? monitor.getStatus(providerId) : undefined;
      if (!snapshot) {
        res.status(404).json({ error: 'Unknown provider' });
        return;
      }
      res.json(snapshot);
    },
  };
}
