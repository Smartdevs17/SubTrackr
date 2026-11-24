/**
 * backend/src/webhooks/__tests__/jwt.test.ts
 *
 * Unit tests for webhook JWT claim validation.
 * Run with: npx jest backend/src/webhooks/__tests__/jwt.test.ts
 */

import {
  WebhookJwtError,
  base64UrlDecodeToBytes,
  utf8Decode,
  decodeJsonSegment,
  parseWebhookJwt,
  normalizeOrigin,
  compilePolicy,
  validateWebhookClaims,
  validateWebhookJwt,
  enforceWebhookJwt,
  createWebhookJwtValidator,
  type WebhookJwtPolicy,
  type WebhookJwtClaims,
} from '../jwt';

// ?? Test helpers ?????????????????????????????????????????????????????????

function enc(obj: unknown): string {
  const json = JSON.stringify(obj);
  return encStr(json);
}

function encStr(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(
  claims: WebhookJwtClaims,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  return `${enc(header)}.${enc(claims)}.c2lnbmF0dXJl`;
}

const NOW = 1_700_000_000; // 2023-11-14T22:13:20Z

const POLICY: WebhookJwtPolicy = {
  audiences: ['webhook-prod', 'webhook-internal'],
  allowedOrigins: ['https://billing.example.com', 'https://api.example.com/'],
  issuer: 'https://issuer.example.com',
  requireExpiration: true,
  clockToleranceSeconds: 30,
};

function validClaims(overrides: Partial<WebhookJwtClaims> = {}): WebhookJwtClaims {
  return {
    aud: 'webhook-prod',
    origin: 'https://billing.example.com',
    iss: 'https://issuer.example.com',
    exp: NOW + 600,
    iat: NOW - 10,
    sub: 'invoice-123',
    jti: 'evt-1',
    ...overrides,
  };
}

// ?? Base64URL / UTF-8 ???????????????????????????????????????????????????

describe('Base64URL + UTF-8 decoding', () => {
  it('round-trips ASCII', () => {
    const bytes = base64UrlDecodeToBytes(encStr('hello world'));
    expect(utf8Decode(bytes)).toBe('hello world');
  });

  it('round-trips multi-byte UTF-8', () => {
    const text = 'caf\u00e9 \u20ac \ud83d\ude00';
    expect(utf8Decode(base64UrlDecodeToBytes(encStr(text)))).toBe(text);
  });

  it('decodes Base64URL with standard padding removed', () => {
    expect(utf8Decode(base64UrlDecodeToBytes('aGVsbG8'))).toBe('hello');
  });

  it('rejects invalid Base64URL characters', () => {
    expect(() => base64UrlDecodeToBytes('abc+def')).toThrow(WebhookJwtError);
  });

  it('decodes JSON segments into objects', () => {
    expect(decodeJsonSegment(enc({ a: 1 }))).toEqual({ a: 1 });
  });

  it('rejects non-object JSON segments', () => {
    expect(() => decodeJsonSegment(enc([1, 2]))).toThrow(WebhookJwtError);
    expect(() => decodeJsonSegment(enc('string'))).toThrow(WebhookJwtError);
  });
});

// ?? Parsing ?????????????????????????????????????????????????????????????

describe('parseWebhookJwt', () => {
  it('parses header, claims, signature and signing input', () => {
    const token = makeToken(validClaims());
    const parsed = parseWebhookJwt(token);
    expect(parsed.header.alg).toBe('HS256');
    expect(parsed.claims.aud).toBe('webhook-prod');
    expect(parsed.signature).toBe('c2lnbmF0dXJl');
    expect(parsed.signingInput.split('.')).toHaveLength(2);
  });

  it('rejects empty tokens', () => {
    expect(() => parseWebhookJwt('')).toThrow(WebhookJwtError);
  });

  it('rejects tokens with wrong segment count', () => {
    expect(() => parseWebhookJwt('a.b')).toThrow(WebhookJwtError);
    expect(() => parseWebhookJwt('a.b.c.d')).toThrow(WebhookJwtError);
  });

  it('rejects tokens with empty segments', () => {
    expect(() => parseWebhookJwt('a..c')).toThrow(WebhookJwtError);
  });

  it('rejects headers without alg', () => {
    const token = makeToken(validClaims(), { typ: 'JWT' });
    expect(() => parseWebhookJwt(token)).toThrow(WebhookJwtError);
  });
});

// ?? Origin normalization ????????????????????????????????????????????????

describe('normalizeOrigin', () => {
  it('lower-cases scheme and host', () => {
    expect(normalizeOrigin('HTTPS://Billing.Example.com')).toBe('https://billing.example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeOrigin('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('preserves an explicit port', () => {
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('strips path, query and fragment', () => {
    expect(normalizeOrigin('https://api.example.com/v1/webhook?x=1#f')).toBe('https://api.example.com');
  });

  it('rejects non-http schemes', () => {
    expect(() => normalizeOrigin('ftp://example.com')).toThrow(WebhookJwtError);
  });

  it('rejects relative values', () => {
    expect(() => normalizeOrigin('example.com')).toThrow(WebhookJwtError);
  });
});

// ?? Policy compilation ??????????????????????????????????????????????????

describe('compilePolicy', () => {
  it('fills defaults and normalizes origins', () => {
    const policy = compilePolicy({
      audiences: ['a'],
      allowedOrigins: ['https://A.Example.com/'],
    });
    expect(policy.allowedOrigins).toEqual(['https://a.example.com']);
    expect(policy.requireExpiration).toBe(true);
    expect(policy.clockToleranceSeconds).toBe(30);
  });

  it('rejects empty audiences', () => {
    expect(() => compilePolicy({ audiences: [], allowedOrigins: ['https://a.com'] })).toThrow(WebhookJwtError);
  });

  it('rejects empty origins', () => {
    expect(() => compilePolicy({ audiences: ['a'], allowedOrigins: [] })).toThrow(WebhookJwtError);
  });

  it('rejects negative clock tolerance', () => {
    expect(() => compilePolicy({
      audiences: ['a'],
      allowedOrigins: ['https://a.com'],
      clockToleranceSeconds: -1,
    })).toThrow(WebhookJwtError);
  });
});

// ?? Claim validation ????????????????????????????????????????????????????

describe('validateWebhookClaims - happy path', () => {
  it('accepts a fully valid token', () => {
    const result = validateWebhookClaims(validClaims(), POLICY, NOW);
    expect(result.valid).toBe(true);
    expect(result.matchedAudience).toBe('webhook-prod');
    expect(result.normalizedOrigin).toBe('https://billing.example.com');
  });

  it('accepts audience expressed as an array with one intersection', () => {
    const claims = validClaims({ aud: ['other', 'webhook-internal'] });
    const result = validateWebhookClaims(claims, POLICY, NOW);
    expect(result.valid).toBe(true);
    expect(result.matchedAudience).toBe('webhook-internal');
  });

  it('accepts an origin with a trailing slash in the claim', () => {
    const claims = validClaims({ origin: 'https://API.EXAMPLE.COM/' });
    expect(validateWebhookClaims(claims, POLICY, NOW).valid).toBe(true);
  });

  it('accepts a token expiring within the clock tolerance', () => {
    const claims = validClaims({ exp: NOW - 10 });
    expect(validateWebhookClaims(claims, POLICY, NOW).valid).toBe(true);
  });

  it('accepts missing exp when requireExpiration is false', () => {
    const policy = { ...POLICY, requireExpiration: false };
    const claims = validClaims();
    delete claims.exp;
    expect(validateWebhookClaims(claims, policy, NOW).valid).toBe(true);
  });
});

describe('validateWebhookClaims - failure modes', () => {
  function codesFor(claims: WebhookJwtClaims, policy: WebhookJwtPolicy = POLICY): string | undefined {
    return validateWebhookClaims(claims, policy, NOW).error?.code;
  }

  it('rejects a missing audience', () => {
    const claims = validClaims();
    delete claims.aud;
    expect(codesFor(claims)).toBe('MISSING_AUDIENCE');
  });

  it('rejects a wrong audience', () => {
    expect(codesFor(validClaims({ aud: 'webhook-staging' }))).toBe('INVALID_AUDIENCE');
  });

  it('rejects a missing origin', () => {
    const claims = validClaims();
    delete claims.origin;
    expect(codesFor(claims)).toBe('MISSING_ORIGIN');
  });

  it('rejects a non-allow-listed origin', () => {
    expect(codesFor(validClaims({ origin: 'https://evil.example.com' }))).toBe('INVALID_ORIGIN');
  });

  it('rejects a missing issuer when required', () => {
    const claims = validClaims();
    delete claims.iss;
    expect(codesFor(claims)).toBe('MISSING_ISSUER');
  });

  it('rejects a wrong issuer', () => {
    expect(codesFor(validClaims({ iss: 'https://evil.example.com' }))).toBe('INVALID_ISSUER');
  });

  it('rejects a missing expiry when required', () => {
    const claims = validClaims();
    delete claims.exp;
    expect(codesFor(claims)).toBe('MISSING_EXPIRY');
  });

  it('rejects an expired token beyond tolerance', () => {
    expect(codesFor(validClaims({ exp: NOW - 100 }))).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token that is not yet valid', () => {
    expect(codesFor(validClaims({ nbf: NOW + 100 }))).toBe('TOKEN_NOT_YET_VALID');
  });

  it('accepts nbf within tolerance', () => {
    expect(codesFor(validClaims({ nbf: NOW + 10 }))).toBeUndefined();
  });
});

// ?? Public validators ???????????????????????????????????????????????????

describe('validateWebhookJwt / enforceWebhookJwt', () => {
  it('validates a compact token end-to-end', () => {
    const result = validateWebhookJwt(makeToken(validClaims()), POLICY, NOW);
    expect(result.valid).toBe(true);
  });

  it('returns a MALFORMED_TOKEN result for garbage input', () => {
    expect(validateWebhookJwt('not-a-jwt', POLICY, NOW).error?.code).toBe('MALFORMED_TOKEN');
  });

  it('enforce throws on a rejected token', () => {
    expect(() => enforceWebhookJwt(makeToken(validClaims({ aud: 'bad' })), POLICY, NOW)).toThrow(WebhookJwtError);
  });

  it('enforce returns result for a valid token', () => {
    expect(enforceWebhookJwt(makeToken(validClaims()), POLICY, NOW).valid).toBe(true);
  });
});

describe('createWebhookJwtValidator with hooks', () => {
  function makeHooks() {
    const calls: Array<{ name: string; labels?: Readonly<Record<string, string>> }> = [];
    const warnings: Array<Record<string, unknown>> = [];
    return {
      calls,
      warnings,
      metrics: { increment: (name: string, labels?: Readonly<Record<string, string>>) => calls.push({ name, labels }) },
      logger: {
        info: () => {},
        warn: (_m: string, ctx?: Readonly<Record<string, unknown>>) => warnings.push(ctx ?? {}),
      },
    };
  }

  it('emits a valid metric and no warning on success', () => {
    const hooks = makeHooks();
    const validator = createWebhookJwtValidator(POLICY, hooks);
    expect(validator.validate(makeToken(validClaims()), NOW).valid).toBe(true);
    expect(hooks.calls.some((c) => c.name === 'webhook.jwt.valid')).toBe(true);
    expect(hooks.warnings).toHaveLength(0);
  });

  it('emits a rejected metric and warning on failure', () => {
    const hooks = makeHooks();
    const validator = createWebhookJwtValidator(POLICY, hooks);
    const result = validator.validate(makeToken(validClaims({ origin: 'https://evil.com' })), NOW);
    expect(result.valid).toBe(false);
    expect(hooks.calls.some((c) => c.name === 'webhook.jwt.rejected')).toBe(true);
    expect(hooks.warnings).toHaveLength(1);
  });
});
