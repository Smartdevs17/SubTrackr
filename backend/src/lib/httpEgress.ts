/**
 * backend/src/lib/httpEgress.ts
 *
 * Outbound HTTP egress allow-list for the backend. This module provides
 * a zero-dependency, side-effect-free allow-list checker that can be used
 * by any HTTP client wrapper to enforce egress policies at the call site.
 *
 * Design rules (issue #2277):
 *  - Pure functions only: no I/O, no network calls, no clock reads.
 *  - Configuration is declarative and loaded at startup from env / config.
 *  - Every rejection is a typed `EgressError` with a stable `code`.
 *  - Supports both exact host matches and wildcard patterns (e.g. `*.api.stripe.com`).
 *  - Observability hooks for metrics and audit logging.
 *
 * Usage:
 *   import { checkEgress, EgressError } from '../lib/httpEgress';
 *   const allowed = checkEgress('https://api.stripe.com/v1/customers');
 *   if (!allowed) throw new EgressError('HOST_NOT_ALLOWED', 'Egress denied');
 */

// ?? Types ???????????????????????????????????????????????????????????????

export type EgressErrorCode =
  | 'HOST_NOT_ALLOWED'
  | 'INVALID_URL'
  | 'INVALID_CONFIG'
  | 'WILDCARD_MISMATCH';

export class EgressError extends Error {
  readonly code: EgressErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: EgressErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'EgressError';
    this.code = code;
    this.details = details;
  }
}

export interface EgressRule {
  /** Host pattern, e.g. `api.stripe.com` or `*.googleapis.com`. */
  hostPattern: string;
  /** Optional path prefix that must match (e.g. `/v1/`). Empty = any path. */
  pathPrefix?: string;
  /** Optional allowed HTTP methods. Empty = all methods allowed. */
  methods?: readonly string[];
  /** Human-readable description for audit logs. */
  description: string;
}

export interface EgressConfig {
  /** Default deny: if true, only explicitly allowed hosts pass. If false, allow all unless explicitly blocked. */
  defaultDeny: boolean;
  /** Allow-list rules. Evaluated in order; first match wins. */
  allowList: readonly EgressRule[];
  /** Block-list rules (evaluated before allow-list when defaultDeny=false). */
  blockList?: readonly EgressRule[];
}

export interface EgressCheckResult {
  allowed: boolean;
  matchedRule?: EgressRule;
  reason?: string;
}

// ?? Configuration ???????????????????????????????????????????????????????????

/**
 * Parse a host pattern into a regex. Supports exact matches and
 * single-level wildcards (`*.example.com`).
 */
export function patternToRegex(pattern: string): RegExp {
  // First escape all regex special chars except *
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Then replace * with [^.]+ for single-level wildcard
  const withWildcard = escaped.replace(/\*/g, '[^.]+');
  return new RegExp(`^${withWildcard}$`, 'i');
}

/** Validate and compile the egress configuration. */
export function compileEgressConfig(config: EgressConfig): CompiledEgressConfig {
  if (config.defaultDeny && config.allowList.length === 0) {
    throw new EgressError('INVALID_CONFIG', 'defaultDeny=true requires at least one allowList rule');
  }

  const compiledAllow = config.allowList.map((rule) => ({
    ...rule,
    hostRegex: patternToRegex(rule.hostPattern),
  }));

  const compiledBlock = (config.blockList ?? []).map((rule) => ({
    ...rule,
    hostRegex: patternToRegex(rule.hostPattern),
  }));

  return {
    defaultDeny: config.defaultDeny,
    allowList: compiledAllow,
    blockList: compiledBlock,
  };
}

export interface CompiledEgressRule extends EgressRule {
  hostRegex: RegExp;
}

export interface CompiledEgressConfig {
  defaultDeny: boolean;
  allowList: readonly CompiledEgressRule[];
  blockList: readonly CompiledEgressRule[];
}

/** Default configuration allowing common payment/webhook providers. */
export const DEFAULT_EGRESS_CONFIG: EgressConfig = {
  defaultDeny: true,
  allowList: [
    {
      hostPattern: 'api.stripe.com',
      pathPrefix: '/v1/',
      methods: ['GET', 'POST', 'DELETE'],
      description: 'Stripe API v1',
    },
    {
      hostPattern: 'api.paypal.com',
      pathPrefix: '/v2/',
      methods: ['GET', 'POST'],
      description: 'PayPal API v2',
    },
    {
      hostPattern: '*.googleapis.com',
      pathPrefix: '',
      methods: ['GET', 'POST'],
      description: 'Google APIs (Firebase, Cloud Tasks, etc.)',
    },
    {
      hostPattern: 'hooks.slack.com',
      pathPrefix: '/services/',
      methods: ['POST'],
      description: 'Slack incoming webhooks',
    },
    {
      hostPattern: 'api.github.com',
      pathPrefix: '/',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      description: 'GitHub API',
    },
    {
      hostPattern: 'api.openai.com',
      pathPrefix: '/v1/',
      methods: ['POST'],
      description: 'OpenAI API',
    },
    {
      hostPattern: 'api.anthropic.com',
      pathPrefix: '/v1/',
      methods: ['POST'],
      description: 'Anthropic API',
    },
    {
      hostPattern: 'webhook.site',
      pathPrefix: '/',
      methods: ['POST'],
      description: 'Webhook testing endpoint',
    },
    {
      hostPattern: 'webhook-test.com',
      pathPrefix: '/',
      methods: ['POST'],
      description: 'Webhook testing endpoint',
    },
    {
      hostPattern: 'localhost',
      pathPrefix: '',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      description: 'Local development',
    },
    {
      hostPattern: '127.0.0.1',
      pathPrefix: '',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      description: 'Local development (IP)',
    },
    {
      hostPattern: 'host.docker.internal',
      pathPrefix: '',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      description: 'Docker host from container',
    },
  ],
  blockList: [],
};

// ?? Core Logic ?????????????????????????????????????????????????????????????

/**
 * Check if a host matches any rule in the list.
 */
function matchHost(host: string, rules: readonly CompiledEgressRule[]): CompiledEgressRule | null {
  for (const rule of rules) {
    if (rule.hostRegex.test(host)) {
      return rule;
    }
  }
  return null;
}

/**
 * Check if a path matches the rule's pathPrefix.
 */
function matchPath(path: string, rule: CompiledEgressRule): boolean {
  if (!rule.pathPrefix || rule.pathPrefix === '') {
    return true;
  }
  return path.startsWith(rule.pathPrefix);
}

/**
 * Check if the HTTP method is allowed by the rule.
 */
function matchMethod(method: string, rule: CompiledEgressRule): boolean {
  if (!rule.methods || rule.methods.length === 0) {
    return true;
  }
  return rule.methods.includes(method.toUpperCase());
}

/**
 * Main egress check function. Returns the check result with details.
 */
export function checkEgress(
  url: string,
  config: CompiledEgressConfig,
  method: string = 'GET'
): EgressCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      allowed: false,
      reason: 'INVALID_URL',
    };
  }

  const host = parsed.hostname;
  const path = parsed.pathname;

  // Check block-list first (when defaultDeny=false)
  if (!config.defaultDeny) {
    const blocked = matchHost(host, config.blockList);
    if (blocked && matchPath(path, blocked) && matchMethod(method, blocked)) {
      return {
        allowed: false,
        matchedRule: blocked,
        reason: 'BLOCKED',
      };
    }
  }

  // Check allow-list
  const allowed = matchHost(host, config.allowList);
  if (allowed && matchPath(path, allowed) && matchMethod(method, allowed)) {
    return {
      allowed: true,
      matchedRule: allowed,
    };
  }

  // No match
  if (config.defaultDeny) {
    return {
      allowed: false,
      reason: 'HOST_NOT_ALLOWED',
    };
  }

  // defaultAllow mode: allow if not blocked
  return {
    allowed: true,
  };
}

/**
 * Convenience function that throws on denial.
 */
export function enforceEgress(
  url: string,
  config: CompiledEgressConfig,
  method: string = 'GET'
): void {
  const result = checkEgress(url, config, method);
  if (!result.allowed) {
    throw new EgressError(
      (result.reason as EgressErrorCode) ?? 'HOST_NOT_ALLOWED',
      `Egress denied for ${url}: ${result.reason}`,
      { url, method, reason: result.reason, matchedRule: result.matchedRule?.description }
    );
  }
}

// ?? Observability ?????????????????????????????????????????????????????????????

export interface EgressMetrics {
  recordAllowed(host: string, method: string): void;
  recordDenied(host: string, method: string, reason: string): void;
  recordError(host: string, method: string, error: string): void;
}

export const noopEgressMetrics: EgressMetrics = {
  recordAllowed: () => {},
  recordDenied: () => {},
  recordError: () => {},
};

/**
 * Wrapper that adds metrics to the egress check.
 */
export function checkEgressWithMetrics(
  url: string,
  config: CompiledEgressConfig,
  method: string,
  metrics: EgressMetrics
): EgressCheckResult {
  try {
    const result = checkEgress(url, config, method);
    if (result.allowed) {
      metrics.recordAllowed(new URL(url).hostname, method);
    } else {
      metrics.recordDenied(new URL(url).hostname, method, result.reason ?? 'UNKNOWN');
    }
    return result;
  } catch (error) {
    metrics.recordError(
      new URL(url).hostname,
      method,
      error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    );
    return {
      allowed: false,
      reason: 'ERROR',
    };
  }
}

/**
 * Factory to create a pre-configured egress checker.
 */
export function createEgressChecker(
  config: EgressConfig = DEFAULT_EGRESS_CONFIG,
  metrics: EgressMetrics = noopEgressMetrics
) {
  const compiled = compileEgressConfig(config);
  return {
    check: (url: string, method?: string) =>
      checkEgressWithMetrics(url, compiled, method ?? 'GET', metrics),
    enforce: (url: string, method?: string) => enforceEgress(url, compiled, method ?? 'GET'),
    config: compiled,
  };
}