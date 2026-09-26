import type { WalletConnectSessionState } from './types';

export type ConnectionHealthStatus = 'healthy' | 'degraded' | 'disconnected' | 'unknown';

export interface ConnectionHealth {
  status: ConnectionHealthStatus;
  connectedDurationMs: number | null;
  staleSinceMs: number | null;
  issues: string[];
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export function assessConnectionHealth(
  session: WalletConnectSessionState,
  nowMs: number = Date.now()
): ConnectionHealth {
  const issues: string[] = [];

  if (session.status !== 'connected') {
    return {
      status: 'disconnected',
      connectedDurationMs: null,
      staleSinceMs: null,
      issues: [`session_status:${session.status}`],
    };
  }

  const connectedAt = session.connectedAt ? new Date(session.connectedAt).getTime() : null;
  const lastUpdatedAt = new Date(session.lastUpdatedAt).getTime();

  const connectedDurationMs = connectedAt !== null ? nowMs - connectedAt : null;
  const staleSinceMs = nowMs - lastUpdatedAt;

  if (!session.address) issues.push('missing_address');
  if (!session.chainId) issues.push('missing_chain_id');
  if (!session.sessionTopic) issues.push('missing_session_topic');
  if (staleSinceMs > STALE_THRESHOLD_MS) issues.push('session_stale');

  const status: ConnectionHealthStatus =
    issues.length === 0 ? 'healthy' : issues.includes('session_stale') ? 'degraded' : 'degraded';

  return { status, connectedDurationMs, staleSinceMs, issues };
}

export function formatConnectionDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
