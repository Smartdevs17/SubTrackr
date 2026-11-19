import { buildSignedDeepLink, verifySignedDeepLink, SENSITIVE_ROUTES } from '../signedLink';

const SECRET = 'test-signing-secret-32-bytes-long!!';
const NOW = 1_700_000_000;

describe('buildSignedDeepLink', () => {
  it('produces a URL with _sig and _ts params', () => {
    const url = buildSignedDeepLink(
      { route: 'billing/confirm', params: { subscriptionId: 'sub_123' }, issuedAt: NOW },
      SECRET,
    );
    expect(url).toMatch(/^subtrackr:\/\/billing\/confirm\?/);
    expect(url).toContain('_sig=');
    expect(url).toContain('_ts=');
    expect(url).toContain('subscriptionId=sub_123');
  });
});

describe('verifySignedDeepLink', () => {
  it('verifies a correctly signed link', () => {
    const url = buildSignedDeepLink(
      { route: 'billing/confirm', params: { subscriptionId: 'sub_123' }, issuedAt: NOW },
      SECRET,
    );
    const result = verifySignedDeepLink(url, SECRET, NOW + 10);
    expect(result.valid).toBe(true);
    expect(result.route).toBe('billing/confirm');
    expect(result.params).toEqual({ subscriptionId: 'sub_123' });
  });

  it('rejects a tampered param', () => {
    const url = buildSignedDeepLink(
      { route: 'billing/confirm', params: { subscriptionId: 'sub_123' }, issuedAt: NOW },
      SECRET,
    );
    const tampered = url.replace('sub_123', 'sub_EVIL');
    const result = verifySignedDeepLink(tampered, SECRET, NOW + 10);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature mismatch/i);
  });

  it('rejects a link signed with the wrong secret', () => {
    const url = buildSignedDeepLink(
      { route: 'billing/cancel', params: { subscriptionId: 'sub_456' }, issuedAt: NOW },
      'wrong-secret',
    );
    const result = verifySignedDeepLink(url, SECRET, NOW + 10);
    expect(result.valid).toBe(false);
  });

  it('rejects an expired link (> 5 minutes old)', () => {
    const url = buildSignedDeepLink(
      { route: 'settings/payment-method', params: { methodId: 'm1' }, issuedAt: NOW },
      SECRET,
    );
    const result = verifySignedDeepLink(url, SECRET, NOW + 6 * 60);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects a link with a future timestamp beyond clock skew', () => {
    const url = buildSignedDeepLink(
      { route: 'settings/plan-change', params: { planId: 'pro' }, issuedAt: NOW + 120 },
      SECRET,
    );
    const result = verifySignedDeepLink(url, SECRET, NOW);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/future/i);
  });

  it('rejects a link missing the signature', () => {
    const result = verifySignedDeepLink(
      'subtrackr://billing/confirm?subscriptionId=sub_123&_ts=1700000000',
      SECRET,
      NOW + 10,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('allows non-sensitive routes without a signature', () => {
    const result = verifySignedDeepLink('subtrackr://home?tab=overview', SECRET, NOW);
    expect(result.valid).toBe(true);
  });

  it('rejects a malformed URL', () => {
    const result = verifySignedDeepLink('not-a-url', SECRET, NOW);
    expect(result.valid).toBe(false);
  });

  it('covers all sensitive routes', () => {
    for (const route of SENSITIVE_ROUTES) {
      const url = buildSignedDeepLink(
        { route: route as any, params: { id: '1' }, issuedAt: NOW },
        SECRET,
      );
      const result = verifySignedDeepLink(url, SECRET, NOW + 5);
      expect(result.valid).toBe(true);
      expect(result.route).toBe(route);
    }
  });
});
