import { assessConnectionHealth, formatConnectionDuration } from '../connectionHealth';
import type { WalletConnectSessionState } from '../types';

function makeSession(overrides: Partial<WalletConnectSessionState> = {}): WalletConnectSessionState {
  const now = new Date().toISOString();
  return {
    status: 'connected',
    address: '0xabc123',
    chainId: 1,
    supportedChainIds: [1, 137],
    connectedAt: now,
    lastUpdatedAt: now,
    pairingUri: 'subtrackr://walletconnect?payload=test',
    sessionTopic: 'wc-v2:1:0xabc123',
    lastError: null,
    disconnectReason: null,
    ...overrides,
  };
}

describe('assessConnectionHealth', () => {
  it('returns healthy for a fully populated connected session', () => {
    const health = assessConnectionHealth(makeSession());
    expect(health.status).toBe('healthy');
    expect(health.issues).toHaveLength(0);
  });

  it('returns disconnected when session status is not connected', () => {
    const health = assessConnectionHealth(makeSession({ status: 'disconnected' }));
    expect(health.status).toBe('disconnected');
    expect(health.issues.some((i) => i.includes('session_status'))).toBe(true);
  });

  it('returns disconnected for idle session', () => {
    const health = assessConnectionHealth(makeSession({ status: 'idle' }));
    expect(health.status).toBe('disconnected');
  });

  it('reports missing_address issue', () => {
    const health = assessConnectionHealth(makeSession({ address: null }));
    expect(health.issues).toContain('missing_address');
  });

  it('reports missing_chain_id issue', () => {
    const health = assessConnectionHealth(makeSession({ chainId: null }));
    expect(health.issues).toContain('missing_chain_id');
  });

  it('reports session_stale when lastUpdatedAt is old', () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const health = assessConnectionHealth(makeSession({ lastUpdatedAt: staleTime }));
    expect(health.issues).toContain('session_stale');
    expect(health.status).toBe('degraded');
  });

  it('calculates connectedDurationMs when connectedAt is set', () => {
    const connectedAt = new Date(Date.now() - 30_000).toISOString();
    const health = assessConnectionHealth(makeSession({ connectedAt }));
    expect(health.connectedDurationMs).not.toBeNull();
    expect(health.connectedDurationMs!).toBeGreaterThan(0);
  });

  it('sets connectedDurationMs to null when connectedAt is null', () => {
    const health = assessConnectionHealth(makeSession({ connectedAt: null }));
    expect(health.connectedDurationMs).toBeNull();
  });
});

describe('formatConnectionDuration', () => {
  it('formats seconds for short durations', () => {
    expect(formatConnectionDuration(45_000)).toBe('45s');
  });

  it('formats minutes', () => {
    expect(formatConnectionDuration(3 * 60_000)).toBe('3m');
  });

  it('formats hours', () => {
    expect(formatConnectionDuration(2 * 3_600_000)).toBe('2h');
  });
});
