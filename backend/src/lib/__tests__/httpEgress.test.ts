/**
 * backend/src/lib/__tests__/httpEgress.test.ts
 *
 * Unit tests for the HTTP egress allow-list module.
 * Run with: npx jest backend/src/lib/__tests__/httpEgress.test.ts
 */

import {
  EgressError,
  EgressErrorCode,
  DEFAULT_EGRESS_CONFIG,
  compileEgressConfig,
  checkEgress,
  enforceEgress,
  createEgressChecker,
  patternToRegex,
  type EgressConfig,
  type CompiledEgressConfig,
} from '../httpEgress';

describe('patternToRegex', () => {
  it('escapes special regex characters', () => {
    const regex = patternToRegex('api.stripe.com');
    expect(regex.test('api.stripe.com')).toBe(true);
    expect(regex.test('apiXstripeXcom')).toBe(false);
  });

  it('converts wildcard to single-level match', () => {
    const regex = patternToRegex('*.googleapis.com');
    expect(regex.test('api.googleapis.com')).toBe(true);
    expect(regex.test('oauth.googleapis.com')).toBe(true);
    expect(regex.test('googleapis.com')).toBe(false); // no subdomain
    expect(regex.test('a.b.googleapis.com')).toBe(false); // two levels
  });

  it('handles multiple wildcards', () => {
    const regex = patternToRegex('*.*.example.com');
    expect(regex.test('a.b.example.com')).toBe(true);
    expect(regex.test('a.example.com')).toBe(false);
  });

  it('is case insensitive', () => {
    const regex = patternToRegex('API.STRIPE.COM');
    expect(regex.test('api.stripe.com')).toBe(true);
    expect(regex.test('Api.Stripe.Com')).toBe(true);
  });
});

describe('compileEgressConfig', () => {
  it('compiles allowList rules with regex', () => {
    const config: EgressConfig = {
      defaultDeny: true,
      allowList: [
        { hostPattern: 'api.example.com', description: 'Test' },
      ],
    };
    const compiled = compileEgressConfig(config);
    expect(compiled.allowList).toHaveLength(1);
    expect(compiled.allowList[0].hostRegex).toBeInstanceOf(RegExp);
    expect(compiled.allowList[0].hostRegex.test('api.example.com')).toBe(true);
  });

  it('compiles blockList rules', () => {
    const config: EgressConfig = {
      defaultDeny: false,
      allowList: [],
      blockList: [{ hostPattern: 'bad.example.com', description: 'Blocked' }],
    };
    const compiled = compileEgressConfig(config);
    expect(compiled.blockList).toHaveLength(1);
    expect(compiled.blockList[0].hostRegex.test('bad.example.com')).toBe(true);
  });

  it('throws when defaultDeny=true with empty allowList', () => {
    const config: EgressConfig = {
      defaultDeny: true,
      allowList: [],
    };
    expect(() => compileEgressConfig(config)).toThrow(EgressError);
    expect(() => compileEgressConfig(config)).toThrow('INVALID_CONFIG');
  });

  it('allows empty allowList when defaultDeny=false', () => {
    const config: EgressConfig = {
      defaultDeny: false,
      allowList: [],
    };
    const compiled = compileEgressConfig(config);
    expect(compiled.defaultDeny).toBe(false);
  });
});

describe('checkEgress', () => {
  const config = compileEgressConfig(DEFAULT_EGRESS_CONFIG);

  it('allows exact host match with default method GET', () => {
    const result = checkEgress('https://api.stripe.com/v1/customers', config);
    expect(result.allowed).toBe(true);
    expect(result.matchedRule?.description).toBe('Stripe API v1');
  });

  it('allows wildcard host match', () => {
    const result = checkEgress('https://oauth.googleapis.com/v1/token', config);
    expect(result.allowed).toBe(true);
    expect(result.matchedRule?.description).toBe('Google APIs (Firebase, Cloud Tasks, etc.)');
  });

  it('allows localhost for development', () => {
    const result = checkEgress('http://localhost:3000/api/test', config);
    expect(result.allowed).toBe(true);
    expect(result.matchedRule?.description).toBe('Local development');
  });

  it('allows 127.0.0.1 for development', () => {
    const result = checkEgress('http://127.0.0.1:8080/health', config);
    expect(result.allowed).toBe(true);
  });

  it('allows host.docker.internal for container development', () => {
    const result = checkEgress('http://host.docker.internal:3000/webhook', config);
    expect(result.allowed).toBe(true);
  });

  it('denies unlisted host in defaultDeny mode', () => {
    const result = checkEgress('https://evil.com/steal', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('HOST_NOT_ALLOWED');
  });

  it('denies invalid URL', () => {
    const result = checkEgress('not-a-url', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INVALID_URL');
  });

  it('respects pathPrefix', () => {
    const result = checkEgress('https://api.stripe.com/v2/customers', config);
    expect(result.allowed).toBe(false); // v2 not allowed, only v1
    expect(result.reason).toBe('HOST_NOT_ALLOWED');
  });

  it('respects methods allow-list', () => {
    // Stripe only allows GET, POST, DELETE
    const result = checkEgress('https://api.stripe.com/v1/customers', config, 'PUT');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('HOST_NOT_ALLOWED');
  });

  it('allows all methods when rule has no method restriction', () => {
    const result = checkEgress('http://localhost:3000/anything', config, 'PATCH');
    expect(result.allowed).toBe(true);
  });

  it('works in defaultAllow mode (defaultDeny=false)', () => {
    const allowConfig = compileEgressConfig({
      defaultDeny: false,
      allowList: [],
      blockList: [{ hostPattern: 'blocked.com', description: 'Blocked' }],
    });
    const result = checkEgress('https://allowed.com/api', allowConfig);
    expect(result.allowed).toBe(true);
  });

  it('blocks explicitly in defaultAllow mode', () => {
    const allowConfig = compileEgressConfig({
      defaultDeny: false,
      allowList: [],
      blockList: [{ hostPattern: 'blocked.com', description: 'Blocked' }],
    });
    const result = checkEgress('https://blocked.com/api', allowConfig);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('BLOCKED');
  });
});

describe('enforceEgress', () => {
  const config = compileEgressConfig(DEFAULT_EGRESS_CONFIG);

  it('does not throw for allowed URLs', () => {
    expect(() => enforceEgress('https://api.stripe.com/v1/customers', config)).not.toThrow();
  });

  it('throws EgressError for denied URLs', () => {
    expect(() => enforceEgress('https://evil.com/steal', config)).toThrow(EgressError);
    expect(() => enforceEgress('https://evil.com/steal', config)).toThrow('HOST_NOT_ALLOWED');
  });

  it('includes details in thrown error', () => {
    try {
      enforceEgress('https://evil.com/steal', config);
    } catch (error) {
      expect(error).toBeInstanceOf(EgressError);
      expect((error as EgressError).code).toBe('HOST_NOT_ALLOWED');
      expect((error as EgressError).details.url).toBe('https://evil.com/steal');
    }
  });
});

describe('createEgressChecker', () => {
  it('creates a checker with default config', () => {
    const checker = createEgressChecker();
    const result = checker.check('https://api.stripe.com/v1/customers');
    expect(result.allowed).toBe(true);
  });

  it('creates a checker with custom config', () => {
    const customConfig: EgressConfig = {
      defaultDeny: true,
      allowList: [
        { hostPattern: 'custom.api.com', description: 'Custom API' },
      ],
    };
    const checker = createEgressChecker(customConfig);
    expect(checker.check('https://custom.api.com/endpoint').allowed).toBe(true);
    expect(checker.check('https://other.com/endpoint').allowed).toBe(false);
  });

  it('enforce method throws on denial', () => {
    const checker = createEgressChecker({
      defaultDeny: true,
      allowList: [{ hostPattern: 'allowed.com', description: 'Allowed' }],
    });
    expect(() => checker.enforce('https://allowed.com/test')).not.toThrow();
    expect(() => checker.enforce('https://denied.com/test')).toThrow(EgressError);
  });
});

describe('DEFAULT_EGRESS_CONFIG', () => {
  it('includes Stripe API', () => {
    const stripeRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'api.stripe.com'
    );
    expect(stripeRule).toBeDefined();
    expect(stripeRule?.pathPrefix).toBe('/v1/');
  });

  it('includes PayPal API', () => {
    const paypalRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'api.paypal.com'
    );
    expect(paypalRule).toBeDefined();
  });

  it('includes Google APIs wildcard', () => {
    const googleRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '*.googleapis.com'
    );
    expect(googleRule).toBeDefined();
  });

  it('includes localhost for development', () => {
    const localhostRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'localhost'
    );
    expect(localhostRule).toBeDefined();
  });

  it('includes 127.0.0.1 for development', () => {
    const ipRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '127.0.0.1'
    );
    expect(ipRule).toBeDefined();
  });

  it('includes host.docker.internal for container development', () => {
    const dockerRule = DEFAULT_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'host.docker.internal'
    );
    expect(dockerRule).toBeDefined();
  });

  it('has defaultDeny = true', () => {
    expect(DEFAULT_EGRESS_CONFIG.defaultDeny).toBe(true);
  });
});

describe('EgressError', () => {
  it('has correct code and details', () => {
    const error = new EgressError('HOST_NOT_ALLOWED', 'Test message', { host: 'evil.com' });
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.message).toBe('Test message');
    expect(error.details.host).toBe('evil.com');
    expect(error.name).toBe('EgressError');
  });
});