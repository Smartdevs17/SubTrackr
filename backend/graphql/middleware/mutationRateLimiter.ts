/**
 * GraphQL Mutation Rate Limiter
 *
 * Implements sliding-window mutation rate limiting with per-mutation cost overrides,
 * client key generation (user ID or IP), and flexible store backends.
 */

export interface FieldNode {
  kind: 'Field';
  name: { value: string };
  selectionSet?: SelectionSetNode;
}

export interface SelectionSetNode {
  selections: Array<FieldNode | { kind: string }>;
}

export interface OperationDefinitionNode {
  kind: 'OperationDefinition';
  operation: 'query' | 'mutation' | 'subscription';
  name?: { value: string };
  selectionSet: SelectionSetNode;
}

export interface DocumentNode {
  definitions: Array<OperationDefinitionNode | { kind: string }>;
}

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix timestamp in milliseconds
  currentCost: number;
  clientKey: string;
}

export interface MutationRateLimitOptions {
  windowMs?: number; // Time window in milliseconds (default: 60000 = 1 min)
  maxMutations?: number; // Maximum allowed mutation points in window (default: 10)
  defaultCost?: number; // Default cost per mutation field (default: 1)
  mutationCosts?: Record<string, number>; // Specific mutation field cost overrides (e.g., { createSubscription: 3 })
  keyGenerator?: (contextOrReq: any) => string; // Function to extract rate limit key (default: user ID || IP || 'anonymous')
  store?: MutationRateLimitStore; // Optional custom store
}

export interface MutationRateLimitStore {
  increment(key: string, amount: number, windowMs: number): Promise<{ total: number; resetTime: number }> | { total: number; resetTime: number };
  get(key: string): Promise<{ total: number; resetTime: number } | null> | { total: number; resetTime: number } | null;
  reset(key: string): Promise<void> | void;
}

/**
 * In-memory sliding window rate limit store.
 */
export class InMemoryMutationRateLimitStore implements MutationRateLimitStore {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(cleanupPeriodMs = 60000) {
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupPeriodMs);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  public increment(key: string, amount: number, windowMs: number): { total: number; resetTime: number } {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || now >= existing.resetTime) {
      const resetTime = now + windowMs;
      const record = { count: amount, resetTime };
      this.hits.set(key, record);
      return { total: amount, resetTime };
    }

    existing.count += amount;
    return { total: existing.count, resetTime: existing.resetTime };
  }

  public get(key: string): { total: number; resetTime: number } | null {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || now >= existing.resetTime) {
      if (existing) this.hits.delete(key);
      return null;
    }
    return { total: existing.count, resetTime: existing.resetTime };
  }

  public reset(key: string): void {
    this.hits.delete(key);
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now >= record.resetTime) {
        this.hits.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.hits.clear();
  }
}

/**
 * Extracts mutation field names and calculates total operation mutation cost from a GraphQL DocumentNode.
 */
export function analyzeMutationCost(
  document: DocumentNode,
  options: { defaultCost?: number; mutationCosts?: Record<string, number> } = {}
): { isMutation: boolean; mutationNames: string[]; totalCost: number } {
  const defaultCost = options.defaultCost ?? 1;
  const costs = options.mutationCosts || {};

  let isMutation = false;
  const mutationNames: string[] = [];
  let totalCost = 0;

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition' && def.operation === 'mutation') {
      isMutation = true;
      if (def.selectionSet && def.selectionSet.selections) {
        for (const sel of def.selectionSet.selections) {
          if (sel.kind === 'Field') {
            const fieldName = (sel as FieldNode).name.value;
            mutationNames.push(fieldName);
            const cost = costs[fieldName] !== undefined ? costs[fieldName] : defaultCost;
            totalCost += cost;
          }
        }
      }
    }
  }

  return { isMutation, mutationNames, totalCost };
}

/**
 * Default rate limit key generator.
 */
export function defaultKeyGenerator(contextOrReq: any): string {
  if (!contextOrReq) return 'anonymous';
  if (contextOrReq.user?.id) return `user:${contextOrReq.user.id}`;
  if (contextOrReq.userId) return `user:${contextOrReq.userId}`;
  if (contextOrReq.req?.user?.id) return `user:${contextOrReq.req.user.id}`;
  if (contextOrReq.ip) return `ip:${contextOrReq.ip}`;
  if (contextOrReq.req?.ip) return `ip:${contextOrReq.req.ip}`;
  if (contextOrReq.headers && contextOrReq.headers['x-forwarded-for']) {
    return `ip:${contextOrReq.headers['x-forwarded-for'].split(',')[0].trim()}`;
  }
  return 'anonymous';
}

/**
 * Main GraphQL Mutation Rate Limiter class.
 */
export class GraphQLMutationRateLimiter {
  private windowMs: number;
  private maxMutations: number;
  private defaultCost: number;
  private mutationCosts: Record<string, number>;
  private keyGenerator: (contextOrReq: any) => string;
  private store: MutationRateLimitStore;

  constructor(options: MutationRateLimitOptions = {}) {
    this.windowMs = options.windowMs ?? 60000;
    this.maxMutations = options.maxMutations ?? 10;
    this.defaultCost = options.defaultCost ?? 1;
    this.mutationCosts = options.mutationCosts || {};
    this.keyGenerator = options.keyGenerator || defaultKeyGenerator;
    this.store = options.store || new InMemoryMutationRateLimitStore();
  }

  /**
   * Checks and consumes mutation quota for a given GraphQL operation document.
   */
  public async check(document: DocumentNode, contextOrReq: any): Promise<RateLimitStatus> {
    const analysis = analyzeMutationCost(document, {
      defaultCost: this.defaultCost,
      mutationCosts: this.mutationCosts,
    });

    const clientKey = this.keyGenerator(contextOrReq);

    // If document contains no mutations, skip rate limiting
    if (!analysis.isMutation || analysis.totalCost === 0) {
      const existing = await this.store.get(clientKey);
      const remaining = existing ? Math.max(0, this.maxMutations - existing.total) : this.maxMutations;
      return {
        allowed: true,
        limit: this.maxMutations,
        remaining,
        resetTime: existing ? existing.resetTime : Date.now() + this.windowMs,
        currentCost: 0,
        clientKey,
      };
    }

    const { total, resetTime } = await this.store.increment(clientKey, analysis.totalCost, this.windowMs);
    const allowed = total <= this.maxMutations;
    const remaining = Math.max(0, this.maxMutations - total);

    return {
      allowed,
      limit: this.maxMutations,
      remaining,
      resetTime,
      currentCost: analysis.totalCost,
      clientKey,
    };
  }

  /**
   * Resets rate limit counter for a specific client key.
   */
  public async reset(clientKey: string): Promise<void> {
    await this.store.reset(clientKey);
  }
}

/**
 * Creates a middleware function for GraphQL execution (compatible with graphql-http / Apollo / Express).
 */
export function createMutationRateLimitMiddleware(options: MutationRateLimitOptions = {}) {
  const limiter = new GraphQLMutationRateLimiter(options);

  return async function checkMutationRateLimit(document: DocumentNode, contextOrReq: any): Promise<RateLimitStatus> {
    const status = await limiter.check(document, contextOrReq);
    if (!status.allowed) {
      const resetSeconds = Math.ceil((status.resetTime - Date.now()) / 1000);
      const err = new Error(
        `GraphQL mutation rate limit exceeded. Limit: ${status.limit} per ${Math.ceil(
          (options.windowMs || 60000) / 1000
        )}s. Try again in ${resetSeconds}s.`
      );
      (err as any).extensions = {
        code: 'RATE_LIMIT_EXCEEDED',
        http: { status: 429 },
        limit: status.limit,
        remaining: status.remaining,
        resetTime: status.resetTime,
      };
      throw err;
    }
    return status;
  };
}
