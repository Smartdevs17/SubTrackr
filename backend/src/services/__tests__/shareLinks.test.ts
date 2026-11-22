import { createHmac } from 'crypto';
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  ShareLinkError,
  createShareLinkService,
  type ShareLinkEvent,
} from '../shareLinks';

const SECRET = 's'.repeat(40);
const BASE = 'https://app.example.com/share';
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);

function setup(overrides: { now?: () => number } = {}) {
  let clock = T0;
  const events: ShareLinkEvent[] = [];
  const service = createShareLinkService({
    secret: SECRET,
    baseUrl: BASE,
    now: overrides.now ?? (() => clock),
    onEvent: (e) => events.push(e),
  });
  return { service, events, advance: (ms: number) => (clock += ms) };
}

describe('createShareLinkService config', () => {
  it('rejects a short secret', () => {
    expect(() => createShareLinkService({ secret: 'short', baseUrl: BASE })).toThrow(ShareLinkError);
  });

  it('rejects a non-https, non-localhost base URL', () => {
    expect(() => createShareLinkService({ secret: SECRET, baseUrl: 'http://example.com' })).toThrow(
      /https/,
    );
    expect(() => createShareLinkService({ secret: SECRET, baseUrl: 'nonsense' })).toThrow(
      ShareLinkError,
    );
  });

  it('allows http on localhost', () => {
    expect(() =>
      createShareLinkService({ secret: SECRET, baseUrl: 'http://localhost:3000/share' }),
    ).not.toThrow();
  });
});

describe('createShareLink', () => {
  it('builds a URL carrying the token with the default expiry', () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(link.url).toBe(`${BASE}/${link.token}`);
    expect(link.expiresAt).toBe(new Date(T0 + DEFAULT_TTL_SECONDS * 1000).toISOString());
    expect(service.extractToken(link.url)).toBe(link.token);
  });

  it('de-duplicates scopes', () => {
    const { service } = setup();
    const link = service.createShareLink({
      subscriptionId: 'sub-1',
      scopes: ['usage', 'usage', 'summary'],
    });
    expect(link.scopes).toEqual(['usage', 'summary']);
  });

  it('issues unique token IDs', () => {
    const { service } = setup();
    const a = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    const b = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(a.tokenId).not.toBe(b.tokenId);
  });

  it.each([
    [{ subscriptionId: '', scopes: ['summary'] }, 'INVALID_SUBSCRIPTION'],
    [{ subscriptionId: 'sub-1', scopes: [] }, 'INVALID_SCOPES'],
    [{ subscriptionId: 'sub-1', scopes: ['admin'] }, 'INVALID_SCOPES'],
    [{ subscriptionId: 'sub-1', scopes: ['summary'], ttlSeconds: 0 }, 'INVALID_TTL'],
    [{ subscriptionId: 'sub-1', scopes: ['summary'], ttlSeconds: 1.5 }, 'INVALID_TTL'],
    [
      { subscriptionId: 'sub-1', scopes: ['summary'], ttlSeconds: MAX_TTL_SECONDS + 1 },
      'INVALID_TTL',
    ],
  ])('rejects invalid input %#', (input, code) => {
    const { service } = setup();
    expect(() => service.createShareLink(input as never)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});

describe('verify', () => {
  it('accepts a valid token and returns its claims', async () => {
    const { service, events } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary', 'usage'] });
    const result = await service.verify({
      token: link.token,
      requiredScope: 'usage',
      subscriptionId: 'sub-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.subscriptionId).toBe('sub-1');
      expect(result.claims.scopes).toEqual(['summary', 'usage']);
    }
    expect(events.map((e) => e.type)).toEqual(['created', 'verified']);
  });

  it('rejects a scope the token does not grant', async () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(await service.verify({ token: link.token, requiredScope: 'billing' })).toEqual({
      ok: false,
      reason: 'SCOPE_NOT_GRANTED',
    });
  });

  it('rejects a token used for another subscription', async () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(
      await service.verify({ token: link.token, requiredScope: 'summary', subscriptionId: 'sub-2' }),
    ).toEqual({ ok: false, reason: 'WRONG_SUBSCRIPTION' });
  });

  it('rejects an expired token exactly at the expiry second', async () => {
    const { service, advance } = setup();
    const link = service.createShareLink({
      subscriptionId: 'sub-1',
      scopes: ['summary'],
      ttlSeconds: 60,
    });
    advance(59_000);
    expect((await service.verify({ token: link.token, requiredScope: 'summary' })).ok).toBe(true);
    advance(1_000);
    expect(await service.verify({ token: link.token, requiredScope: 'summary' })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('rejects a payload edited to widen the scopes', async () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    const [payload, sig] = link.token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.scopes = ['summary', 'billing'];
    const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    expect(await service.verify({ token: forged, requiredScope: 'billing' })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    const payload = link.token.split('.')[0];
    const forgedSig = createHmac('sha256', 'x'.repeat(40)).update(payload).digest('base64url');
    expect(
      await service.verify({ token: `${payload}.${forgedSig}`, requiredScope: 'summary' }),
    ).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a truncated signature without throwing', async () => {
    const { service } = setup();
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    const result = await service.verify({
      token: link.token.slice(0, -4),
      requiredScope: 'summary',
    });
    expect(result).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it.each(['', 'abc', 'a.b.c', '.', 'a.', '.b', '!!!.???'])('rejects malformed token %j', async (token) => {
    const { service } = setup();
    const result = await service.verify({ token, requiredScope: 'summary' });
    expect(result.ok).toBe(false);
  });

  it('rejects a correctly signed payload with invalid claims', async () => {
    const { service } = setup();
    const payload = Buffer.from(JSON.stringify({ jti: 'x', scopes: ['summary'] })).toString(
      'base64url',
    );
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(await service.verify({ token: `${payload}.${sig}`, requiredScope: 'summary' })).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });
});

describe('revoke', () => {
  it('blocks a revoked token and leaves others valid', async () => {
    const { service, events } = setup();
    const a = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    const b = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(await service.revoke(a.token)).toBe(true);
    expect(await service.verify({ token: a.token, requiredScope: 'summary' })).toEqual({
      ok: false,
      reason: 'REVOKED',
    });
    expect((await service.verify({ token: b.token, requiredScope: 'summary' })).ok).toBe(true);
    expect(events.some((e) => e.type === 'revoked' && e.jti === a.tokenId)).toBe(true);
  });

  it('refuses to revoke a forged or malformed token', async () => {
    const { service } = setup();
    expect(await service.revoke('garbage')).toBe(false);
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect(await service.revoke(`${link.token.split('.')[0]}.AAAA`)).toBe(false);
  });
});

describe('extractToken', () => {
  it('returns undefined for foreign origins, other paths and invalid URLs', () => {
    const { service } = setup();
    expect(service.extractToken('https://evil.example.com/share/abc.def')).toBeUndefined();
    expect(service.extractToken('https://app.example.com/other/abc.def')).toBeUndefined();
    expect(service.extractToken('https://app.example.com/share/')).toBeUndefined();
    expect(service.extractToken('https://app.example.com/share/a/b')).toBeUndefined();
    expect(service.extractToken('not a url')).toBeUndefined();
  });
});

describe('observability', () => {
  it('never lets a throwing hook break the flow and never emits the token', async () => {
    const seen: string[] = [];
    const service = createShareLinkService({
      secret: SECRET,
      baseUrl: BASE,
      onEvent: (e) => {
        seen.push(JSON.stringify(e));
        throw new Error('hook failure');
      },
    });
    const link = service.createShareLink({ subscriptionId: 'sub-1', scopes: ['summary'] });
    expect((await service.verify({ token: link.token, requiredScope: 'summary' })).ok).toBe(true);
    expect(seen.every((s) => !s.includes(link.token) && !s.includes(SECRET))).toBe(true);
  });
});
