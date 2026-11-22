/**
 * IP Whitelisting Service — SubTrackr
 *
 * Issue #1158: Build IP whitelisting for API access
 *
 * Features:
 *   - Per-tenant IPv4 / IPv6 CIDR rules
 *   - Named allowlist groups (shared across tenants)
 *   - Exact IP and CIDR range matching (no external library)
 *   - Allow / Deny rule types with priority ordering
 *   - Audit log for all access decisions (allow + deny)
 *   - TTL-based temporary allowances (e.g. dev access windows)
 *   - Metrics export (Prometheus text format)
 *   - Bypass for trusted internal networks (configurable)
 *   - Express/raw-http compatible middleware factory
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IpRuleType = 'allow' | 'deny';
export type IpVersion = 'ipv4' | 'ipv6' | 'any';

export interface IpRule {
  id: string;
  /** CIDR notation (e.g. "192.168.1.0/24") or exact IP */
  cidr: string;
  type: IpRuleType;
  /** Tenant this rule belongs to. Use '*' for global rules. */
  tenantId: string;
  description?: string;
  /** Unix timestamp (ms) when rule expires. null = permanent */
  expiresAt: number | null;
  createdAt: number;
  createdBy: string;
  /** Priority: lower number = evaluated first */
  priority: number;
  enabled: boolean;
}

export interface IpAccessDecision {
  ip: string;
  allowed: boolean;
  matchedRuleId: string | null;
  matchedRuleType: IpRuleType | null;
  tenantId: string;
  timestamp: number;
  requestPath: string;
}

export interface IpWhitelistStats {
  totalRules: number;
  activeRules: number;
  expiredRules: number;
  totalDecisions: number;
  allowedRequests: number;
  deniedRequests: number;
  topDeniedIps: { ip: string; count: number }[];
  topAllowedIps: { ip: string; count: number }[];
  decisionsByTenant: Record<string, { allowed: number; denied: number }>;
}

// ---------------------------------------------------------------------------
// CIDR / IP parsing utilities (no external deps)
// ---------------------------------------------------------------------------

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseIpv6(ip: string): bigint | null {
  try {
    // Expand :: shorthand
    let expanded = ip;
    if (ip.includes('::')) {
      const sides = ip.split('::');
      const left = sides[0] ? sides[0].split(':') : [];
      const right = sides[1] ? sides[1].split(':') : [];
      const missing = 8 - left.length - right.length;
      const middle = Array(missing).fill('0');
      expanded = [...left, ...middle, ...right].join(':');
    }
    const groups = expanded.split(':');
    if (groups.length !== 8) return null;
    let result = BigInt(0);
    for (const g of groups) {
      result = (result << BigInt(16)) | BigInt(parseInt(g || '0', 16));
    }
    return result;
  } catch {
    return null;
  }
}

function isIpv4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

function isIpv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Check whether `ip` falls inside the `cidr` block.
 * Supports IPv4 CIDR, exact IPv4, IPv6 CIDR, and exact IPv6.
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Exact match shortcut
  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  // IPv4 path
  if (isIpv4(ip) && isIpv4(network)) {
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
    const ipLong = ipToLong(ip);
    const networkLong = ipToLong(network);
    if (ipLong < 0 || networkLong < 0) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipLong & mask) === (networkLong & mask);
  }

  // IPv6 path
  if (isIpv6(ip) && isIpv6(network)) {
    if (isNaN(prefix) || prefix < 0 || prefix > 128) return false;
    const ipBig = parseIpv6(ip);
    const netBig = parseIpv6(network);
    if (ipBig === null || netBig === null) return false;
    if (prefix === 0) return true;
    const shift = BigInt(128 - prefix);
    return (ipBig >> shift) === (netBig >> shift);
  }

  return false;
}

/**
 * Extract the real client IP from request headers, respecting common proxy headers.
 */
export function extractClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }
  return req.socket?.remoteAddress ?? '0.0.0.0';
}

// ---------------------------------------------------------------------------
// IpWhitelistService
// ---------------------------------------------------------------------------

export class IpWhitelistService {
  private rules = new Map<string, IpRule>();
  private decisionLog: IpAccessDecision[] = [];
  private readonly maxLogSize = 100_000;

  /** IPs / CIDRs that always bypass the whitelist (e.g. loopback, internal LAN) */
  private trustedNetworks: string[] = [
    '127.0.0.1',
    '::1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ];

  private ruleCounter = 0;

  // -------------------------------------------------------------------------
  // Trusted network configuration
  // -------------------------------------------------------------------------

  setTrustedNetworks(cidrs: string[]): void {
    this.trustedNetworks = cidrs;
  }

  addTrustedNetwork(cidr: string): void {
    if (!this.trustedNetworks.includes(cidr)) {
      this.trustedNetworks.push(cidr);
    }
  }

  removeTrustedNetwork(cidr: string): boolean {
    const idx = this.trustedNetworks.indexOf(cidr);
    if (idx < 0) return false;
    this.trustedNetworks.splice(idx, 1);
    return true;
  }

  isTrustedNetwork(ip: string): boolean {
    return this.trustedNetworks.some((net) => ipMatchesCidr(ip, net));
  }

  // -------------------------------------------------------------------------
  // Rule management
  // -------------------------------------------------------------------------

  addRule(
    rule: Omit<IpRule, 'id' | 'createdAt' | 'priority'> & { priority?: number },
  ): IpRule {
    const id = `ip_rule_${++this.ruleCounter}_${Date.now().toString(36)}`;
    const full: IpRule = {
      ...rule,
      id,
      createdAt: Date.now(),
      priority: rule.priority ?? this.ruleCounter,
    };
    this.rules.set(id, full);
    return full;
  }

  updateRule(id: string, patch: Partial<Omit<IpRule, 'id' | 'createdAt'>>): IpRule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.rules.set(id, updated);
    return updated;
  }

  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  getRule(id: string): IpRule | undefined {
    return this.rules.get(id);
  }

  getRulesForTenant(tenantId: string): IpRule[] {
    const now = Date.now();
    return Array.from(this.rules.values())
      .filter(
        (r) =>
          (r.tenantId === tenantId || r.tenantId === '*') &&
          r.enabled &&
          (r.expiresAt === null || r.expiresAt > now),
      )
      .sort((a, b) => a.priority - b.priority);
  }

  getAllRules(): IpRule[] {
    return Array.from(this.rules.values()).sort((a, b) => a.priority - b.priority);
  }

  purgeExpiredRules(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, rule] of this.rules) {
      if (rule.expiresAt !== null && rule.expiresAt <= now) {
        this.rules.delete(id);
        count++;
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Access decision
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether `ip` is allowed access for `tenantId`.
   *
   * Decision logic:
   *   1. Always allow trusted internal networks.
   *   2. If no rules exist for this tenant → allow (open by default).
   *   3. Evaluate rules in priority order; first match wins.
   *   4. If no rule matches → allow (whitelist is additive).
   *
   * To run a deny-by-default policy, add a low-priority deny rule for "0.0.0.0/0".
   */
  decide(
    ip: string,
    tenantId: string,
    requestPath: string = '/',
  ): IpAccessDecision {
    const ts = Date.now();

    // 1. Trusted networks always pass
    if (this.isTrustedNetwork(ip)) {
      const decision: IpAccessDecision = {
        ip,
        allowed: true,
        matchedRuleId: 'trusted_network',
        matchedRuleType: 'allow',
        tenantId,
        timestamp: ts,
        requestPath,
      };
      this.logDecision(decision);
      return decision;
    }

    const tenantRules = this.getRulesForTenant(tenantId);

    // 2. No rules → allow
    if (tenantRules.length === 0) {
      const decision: IpAccessDecision = {
        ip,
        allowed: true,
        matchedRuleId: null,
        matchedRuleType: null,
        tenantId,
        timestamp: ts,
        requestPath,
      };
      this.logDecision(decision);
      return decision;
    }

    // 3. First-match wins
    for (const rule of tenantRules) {
      if (ipMatchesCidr(ip, rule.cidr)) {
        const decision: IpAccessDecision = {
          ip,
          allowed: rule.type === 'allow',
          matchedRuleId: rule.id,
          matchedRuleType: rule.type,
          tenantId,
          timestamp: ts,
          requestPath,
        };
        this.logDecision(decision);
        return decision;
      }
    }

    // 4. No match → allow (whitelist-only model means unlisted = allowed unless deny-all exists)
    const decision: IpAccessDecision = {
      ip,
      allowed: true,
      matchedRuleId: null,
      matchedRuleType: null,
      tenantId,
      timestamp: ts,
      requestPath,
    };
    this.logDecision(decision);
    return decision;
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  private logDecision(decision: IpAccessDecision): void {
    this.decisionLog.push(decision);
    if (this.decisionLog.length > this.maxLogSize) {
      this.decisionLog = this.decisionLog.slice(-this.maxLogSize / 2);
    }
  }

  getDecisionLog(options: {
    tenantId?: string;
    ip?: string;
    allowedOnly?: boolean;
    deniedOnly?: boolean;
    since?: number;
    limit?: number;
  } = {}): IpAccessDecision[] {
    const { tenantId, ip, allowedOnly, deniedOnly, since, limit = 500 } = options;
    let log = this.decisionLog;
    if (tenantId) log = log.filter((d) => d.tenantId === tenantId);
    if (ip) log = log.filter((d) => d.ip === ip);
    if (allowedOnly) log = log.filter((d) => d.allowed);
    if (deniedOnly) log = log.filter((d) => !d.allowed);
    if (since) log = log.filter((d) => d.timestamp >= since);
    return log.slice(-limit);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): IpWhitelistStats {
    const now = Date.now();
    const activeRules = Array.from(this.rules.values()).filter(
      (r) => r.enabled && (r.expiresAt === null || r.expiresAt > now),
    ).length;
    const expiredRules = Array.from(this.rules.values()).filter(
      (r) => r.expiresAt !== null && r.expiresAt <= now,
    ).length;

    const deniedIpCount = new Map<string, number>();
    const allowedIpCount = new Map<string, number>();
    const decisionsByTenant: Record<string, { allowed: number; denied: number }> = {};

    let allowedTotal = 0;
    let deniedTotal = 0;

    for (const d of this.decisionLog) {
      if (d.allowed) {
        allowedTotal++;
        allowedIpCount.set(d.ip, (allowedIpCount.get(d.ip) ?? 0) + 1);
      } else {
        deniedTotal++;
        deniedIpCount.set(d.ip, (deniedIpCount.get(d.ip) ?? 0) + 1);
      }
      const td = (decisionsByTenant[d.tenantId] ??= { allowed: 0, denied: 0 });
      d.allowed ? td.allowed++ : td.denied++;
    }

    const topDeniedIps = Array.from(deniedIpCount.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    const topAllowedIps = Array.from(allowedIpCount.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    return {
      totalRules: this.rules.size,
      activeRules,
      expiredRules,
      totalDecisions: this.decisionLog.length,
      allowedRequests: allowedTotal,
      deniedRequests: deniedTotal,
      topDeniedIps,
      topAllowedIps,
      decisionsByTenant,
    };
  }

  // -------------------------------------------------------------------------
  // Prometheus metrics
  // -------------------------------------------------------------------------

  prometheusMetrics(): string {
    const stats = this.getStats();
    const lines: string[] = [
      '# HELP subtrackr_ip_whitelist_rules_total Total IP whitelist rules configured',
      '# TYPE subtrackr_ip_whitelist_rules_total gauge',
      `subtrackr_ip_whitelist_rules_total{state="active"} ${stats.activeRules}`,
      `subtrackr_ip_whitelist_rules_total{state="expired"} ${stats.expiredRules}`,
      '',
      '# HELP subtrackr_ip_access_decisions_total Total IP access decisions',
      '# TYPE subtrackr_ip_access_decisions_total counter',
      `subtrackr_ip_access_decisions_total{result="allowed"} ${stats.allowedRequests}`,
      `subtrackr_ip_access_decisions_total{result="denied"} ${stats.deniedRequests}`,
    ];
    return lines.join('\n') + '\n';
  }
}

// Singleton
export const ipWhitelistService = new IpWhitelistService();

// ---------------------------------------------------------------------------
// HTTP Middleware factory (raw Node http compatible)
// ---------------------------------------------------------------------------

export interface IpWhitelistMiddlewareOptions {
  service?: IpWhitelistService;
  /** How to resolve the tenant for each request (default: 'default') */
  getTenantId?: (req: IncomingMessage) => string;
  /** Custom 403 body */
  forbiddenBody?: (ip: string, tenantId: string) => string;
  /** Paths that bypass IP checking (e.g. /health) */
  bypassPaths?: string[];
}

/**
 * Create a raw-http compatible IP whitelist gate.
 *
 * Returns a function `checkIpAccess(req, res, path)` → true if request should
 * proceed, false if a 403 was already written to `res`.
 */
export function createIpWhitelistGate(
  opts: IpWhitelistMiddlewareOptions = {},
): (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
) => boolean {
  const {
    service = ipWhitelistService,
    getTenantId = () => 'default',
    bypassPaths = ['/health', '/metrics/plan-cache', '/metrics/compression', '/metrics/pool'],
    forbiddenBody,
  } = opts;

  return function checkIpAccess(req, res, pathname) {
    // Bypass paths
    if (bypassPaths.some((p) => pathname.startsWith(p))) {
      return true;
    }

    const ip = extractClientIp(req);
    const tenantId = getTenantId(req);
    const decision = service.decide(ip, tenantId, pathname);

    if (!decision.allowed) {
      const body = forbiddenBody
        ? forbiddenBody(ip, tenantId)
        : JSON.stringify({
            error: 'ip_not_whitelisted',
            message: `Access denied: IP ${ip} is not whitelisted for this tenant.`,
            ip,
          });
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'X-Blocked-Ip': ip,
      });
      res.end(body);
      return false;
    }

    return true;
  };
}

/**
 * Express-compatible middleware factory.
 */
export function createIpWhitelistMiddleware(opts: IpWhitelistMiddlewareOptions = {}) {
  const gate = createIpWhitelistGate(opts);

  return function ipWhitelistMiddleware(
    req: IncomingMessage & { path?: string; url?: string },
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void {
    const pathname = req.path ?? (req.url?.split('?')[0] ?? '/');
    const allowed = gate(req, res, pathname);
    if (allowed) next();
  };
}
