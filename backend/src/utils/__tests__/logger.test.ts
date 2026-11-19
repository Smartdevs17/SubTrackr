import { describe, it, expect, beforeEach } from 'vitest';
import { logger, createPiiSafeLogger } from '../logger';

// Capture log output via the in-memory buffer
import { clearLogBuffer, queryLogs } from '../../../services/shared/logging';

beforeEach(() => {
  clearLogBuffer();
});

describe('PII-redacting logger', () => {
  it('passes through non-sensitive metadata unchanged', () => {
    logger.info('test event', { userId: 'u123', plan: 'pro', count: 5 });
    const [entry] = queryLogs({ text: 'test event' });
    expect(entry).toBeDefined();
    expect(entry.meta).toMatchObject({ userId: 'u123', plan: 'pro', count: 5 });
  });

  it('redacts known sensitive keys regardless of value', () => {
    logger.info('auth', { email: 'user@example.com', password: 'secret123' });
    const [entry] = queryLogs({ text: 'auth' });
    expect(entry.meta?.email).toBe('[REDACTED]');
    expect(entry.meta?.password).toBe('[REDACTED]');
  });

  it('redacts token fields', () => {
    logger.debug('token refresh', { accessToken: 'eyJhbGciOiJIUzI1NiJ9.x.y', userId: 'u1' });
    const [entry] = queryLogs({ text: 'token refresh' });
    expect(entry.meta?.accessToken).toBe('[REDACTED]');
    expect(entry.meta?.userId).toBe('u1');
  });

  it('redacts email-like values in non-sensitive-named fields', () => {
    logger.warn('lookup', { query: 'alice@example.com' });
    const [entry] = queryLogs({ text: 'lookup' });
    expect(entry.meta?.query).toBe('[REDACTED]');
  });

  it('redacts Bearer token values', () => {
    logger.error('outbound call failed', { authHeader: 'Bearer eyABC.DEF.GHI' });
    const [entry] = queryLogs({ text: 'outbound call failed' });
    expect(entry.meta?.authHeader).toBe('[REDACTED]');
  });

  it('redacts nested PII fields', () => {
    logger.info('user payload', { user: { email: 'x@y.com', name: 'Alice' } });
    const [entry] = queryLogs({ text: 'user payload' });
    const user = entry.meta?.user as Record<string, unknown>;
    expect(user.email).toBe('[REDACTED]');
    expect(user.name).toBe('Alice');
  });

  it('redacts PII inside arrays', () => {
    logger.info('bulk', { items: [{ email: 'a@b.com' }, { name: 'Bob' }] });
    const [entry] = queryLogs({ text: 'bulk' });
    const items = entry.meta?.items as Array<Record<string, unknown>>;
    expect(items[0].email).toBe('[REDACTED]');
    expect(items[1].name).toBe('Bob');
  });

  it('child logger also redacts PII', () => {
    const child = logger.child('payments');
    child.info('charge', { cardNumber: '4111111111111111', amount: 100 });
    const [entry] = queryLogs({ text: 'charge' });
    expect(entry.meta?.cardNumber).toBe('[REDACTED]');
    expect(entry.meta?.amount).toBe(100);
  });

  it('createPiiSafeLogger produces independent module-scoped logger', () => {
    const svc = createPiiSafeLogger('subscriptions');
    svc.info('plan changed', { plan: 'enterprise', email: 'a@b.com' });
    const [entry] = queryLogs({ module: 'subscriptions' });
    expect(entry).toBeDefined();
    expect(entry.meta?.email).toBe('[REDACTED]');
    expect(entry.meta?.plan).toBe('enterprise');
  });
});
