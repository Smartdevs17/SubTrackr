import {
  CertificatePinner,
  CertificatePinningError,
  hostMatches,
  hostnameOf,
  normalizePin,
  PeerCertificateProvider,
} from '../certificatePinning';
import { ApiClient } from '../apiClient';
import { MobileTracer, MobileSpan } from '../trace';

const PIN_A = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const PIN_B = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
const OTHER = 'sha256/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=';

function makeSpan(): MobileSpan {
  return {
    context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: false },
    name: 'test',
    startTime: 0,
    attributes: {},
    status: 'unset',
  };
}

function makeTracer(): MobileTracer {
  return {
    startClientSpan: jest.fn().mockReturnValue(makeSpan()),
    endSpan: jest.fn(),
  } as unknown as MobileTracer;
}

const okResponse = (data: unknown = { ok: true }): Response =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(data) }) as unknown as Response;

describe('certificate pinning helpers', () => {
  it('normalises pins to a canonical sha256/base64 form', () => {
    expect(normalizePin('sha256/AbC=')).toBe('sha256/abc=');
    expect(normalizePin('sha256:xyz')).toBe('sha256/xyz');
    expect(normalizePin('  barePinValue  ')).toBe('sha256/barepinvalue');
  });

  it('extracts hostnames from absolute URLs, ignoring port and userinfo', () => {
    expect(hostnameOf('https://API.Example.com:8443/v1/subs?x=1')).toBe('api.example.com');
    expect(hostnameOf('https://user:pass@api.example.com')).toBe('api.example.com');
    expect(hostnameOf('api.example.com')).toBe('api.example.com');
  });

  it('matches exact and wildcard hosts', () => {
    expect(hostMatches('api.example.com', 'api.example.com')).toBe(true);
    expect(hostMatches('api.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('evil.com', '*.example.com')).toBe(false);
    expect(hostMatches('example.com', '*.example.com')).toBe(false);
  });
});

describe('CertificatePinner', () => {
  it('matches a configured pin', () => {
    const pinner = new CertificatePinner({ pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] });
    const result = pinner.verify('api.example.com', { spkiSha256: PIN_A });
    expect(result).toMatchObject({ status: 'match', ok: true });
  });

  it('rejects a mismatch in enforce mode', () => {
    const pinner = new CertificatePinner({
      mode: 'enforce',
      pinSets: [{ host: 'api.example.com', pins: [PIN_A] }],
    });
    const result = pinner.verify('api.example.com', { spkiSha256: OTHER });
    expect(result.status).toBe('mismatch');
    expect(result.ok).toBe(false);
    expect(() => pinner.assert('api.example.com', { spkiSha256: OTHER })).toThrow(
      CertificatePinningError
    );
  });

  it('allows a mismatch in report mode (fallback while rolling out pins)', () => {
    const pinner = new CertificatePinner({
      mode: 'report',
      pinSets: [{ host: 'api.example.com', pins: [PIN_A] }],
    });
    const result = pinner.verify('api.example.com', { spkiSha256: OTHER });
    expect(result.status).toBe('mismatch');
    expect(result.ok).toBe(true);
    expect(pinner.assert('api.example.com', { spkiSha256: OTHER }).ok).toBe(true);
  });

  it('skips verification entirely when disabled', () => {
    const pinner = new CertificatePinner({ mode: 'disabled', pinSets: [] });
    expect(pinner.verify('api.example.com', null)).toMatchObject({
      status: 'disabled',
      ok: true,
    });
  });

  it('falls back to allow when the peer certificate is unavailable', () => {
    const pinner = new CertificatePinner({ pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] });
    expect(pinner.verify('api.example.com', null)).toMatchObject({
      status: 'unavailable',
      ok: true,
    });
    expect(pinner.verify('api.example.com', { spkiSha256: '   ' })).toMatchObject({
      status: 'unavailable',
      ok: true,
    });
  });

  it('falls back to block when configured as fail-closed', () => {
    const pinner = new CertificatePinner({
      onUnavailable: 'block',
      pinSets: [{ host: 'api.example.com', pins: [PIN_A] }],
    });
    expect(pinner.verify('api.example.com', null)).toMatchObject({
      status: 'unavailable',
      ok: false,
    });
    expect(() => pinner.assert('api.example.com', null)).toThrow(CertificatePinningError);
  });

  it('treats a host with no pin set as unavailable (documented fallback)', () => {
    const pinner = new CertificatePinner({
      pinSets: [{ host: 'other.example.com', pins: [PIN_A] }],
    });
    expect(pinner.verify('api.example.com', { spkiSha256: PIN_A })).toMatchObject({
      status: 'no_pins',
      ok: true,
    });
  });

  describe('rotation', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    it('ignores expired pin sets so rotated-out pins drop automatically', () => {
      const pinner = new CertificatePinner({
        pinSets: [
          {
            host: 'api.example.com',
            pins: [PIN_A],
            expiresAt: past, // rotated out
          },
        ],
      });
      expect(pinner.activePinSets('api.example.com')).toHaveLength(0);
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A })).toMatchObject({
        status: 'no_pins',
        ok: true,
      });
    });

    it('accepts both the outgoing and incoming pin during the overlap window', () => {
      const pinner = new CertificatePinner({
        pinSets: [
          { host: 'api.example.com', pins: [PIN_A], expiresAt: future },
          { host: 'api.example.com', pins: [PIN_B] },
        ],
      });
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A })).toMatchObject({
        status: 'match',
        ok: true,
      });
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_B })).toMatchObject({
        status: 'match',
        ok: true,
      });
      expect(pinner.verify('api.example.com', { spkiSha256: OTHER }).status).toBe('mismatch');
    });

    it('rejects the old pin once its rotation window has closed', () => {
      const pinner = new CertificatePinner({
        pinSets: [
          { host: 'api.example.com', pins: [PIN_A], expiresAt: past },
          { host: 'api.example.com', pins: [PIN_B] },
        ],
      });
      const after = Date.now() + 60_000;
      expect(pinner.activePinSets('api.example.com', after)).toHaveLength(1);
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A }).status).toBe('mismatch');
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A }).ok).toBe(false);
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_B }).status).toBe('match');
    });
  });

  describe('fromEnv', () => {
    it('builds pin sets from the JSON configuration', () => {
      const pinner = CertificatePinner.fromEnv({
        EXPO_PUBLIC_CERT_PINNING_MODE: 'report',
        EXPO_PUBLIC_CERT_PIN_SETS: JSON.stringify([{ host: '*.example.com', pins: [PIN_A] }]),
      });
      expect(pinner.getMode()).toBe('report');
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A }).status).toBe('match');
    });

    it('supports the single-host comma-separated shorthand', () => {
      const pinner = CertificatePinner.fromEnv({
        EXPO_PUBLIC_CERT_PINS: `${PIN_A}, ${PIN_B}`,
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
      });
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_B }).status).toBe('match');
      expect(pinner.verify('api.example.com', { spkiSha256: OTHER }).status).toBe('mismatch');
    });

    it('falls back to no pins when the JSON configuration is invalid', () => {
      const pinner = CertificatePinner.fromEnv({
        EXPO_PUBLIC_CERT_PIN_SETS: 'not-json',
      });
      expect(pinner.verify('api.example.com', { spkiSha256: PIN_A })).toMatchObject({
        status: 'no_pins',
        ok: true,
      });
    });

    it('honours the fail-closed fallback flag', () => {
      const pinner = CertificatePinner.fromEnv({
        EXPO_PUBLIC_CERT_PIN_UNAVAILABLE: 'block',
        EXPO_PUBLIC_CERT_PIN_SETS: JSON.stringify([{ host: 'api.example.com', pins: [PIN_A] }]),
      });
      expect(pinner.verify('api.example.com', null).ok).toBe(false);
    });
  });
});

describe('ApiClient certificate pinning', () => {
  const provider = (spki: string | null): PeerCertificateProvider =>
    jest.fn(async () => (spki ? { spkiSha256: spki } : null));

  it('performs a pinned request when the peer key matches', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] },
        peerCertificateProvider: provider(PIN_A),
      },
    });

    const res = await client.get('/v1/subscriptions');
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts the request on a pin mismatch in enforce mode (fetch never called)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { mode: 'enforce', pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] },
        peerCertificateProvider: provider(OTHER),
      },
    });

    await expect(client.get('/v1/subscriptions')).rejects.toThrow(CertificatePinningError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('proceeds on a pin mismatch in report mode and records it on the span', async () => {
    const tracer = makeTracer();
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { mode: 'report', pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] },
        peerCertificateProvider: provider(OTHER),
      },
    });

    const res = await client.get('/v1/subscriptions');
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const span = (tracer.startClientSpan as jest.Mock).mock.results[0].value as MobileSpan;
    expect(span.attributes['security.cert_pinning.mode']).toBe('report');
    expect(span.attributes['security.cert_pinning.status']).toBe('mismatch');
  });

  it('falls back to allowing the request when no native peer provider is registered', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { mode: 'enforce', pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] },
        peerCertificateProvider: async () => null,
      },
    });

    const res = await client.get('/v1/subscriptions');
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks the request when fail-closed fallback is configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: {
          mode: 'enforce',
          onUnavailable: 'block',
          pinSets: [{ host: 'api.example.com', pins: [PIN_A] }],
        },
        peerCertificateProvider: async () => null,
      },
    });

    await expect(client.get('/v1/subscriptions')).rejects.toThrow(CertificatePinningError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a provider exception as unavailable rather than crashing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { pinSets: [{ host: 'api.example.com', pins: [PIN_A] }] },
        peerCertificateProvider: async () => {
          throw new Error('native hook exploded');
        },
      },
    });

    const res = await client.get('/v1/subscriptions');
    expect(res.ok).toBe(true);
  });

  it('skips pinning for plain HTTP (dev / mock hosts) even when fail-closed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000',
      tracer: makeTracer(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      certificatePinning: {
        config: { onUnavailable: 'block', pinSets: [] },
        peerCertificateProvider: provider(null),
      },
    });

    const res = await client.get('/v1/subscriptions');
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
