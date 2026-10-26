/**
 * PlanCacheService — Redis-backed distributed cache for subscription plan metadata.
 *
 * Read path:   Redis → (on miss, single-flight) database
 * Write path:  database → Redis (write-through on mutations)
 * TTL:         1 hour default, overridable via plan.metadata.cacheTTL
 */

import { RedisCacheService } from '../../shared/cache/RedisCacheService';
import type { RedisClient } from '../../shared/cache/types';
import { DEFAULT_REDIS_CONFIG, type RedisConfig } from '../../config/redis';
import type { IPlanRepository } from './PlanRepository';
import type { PlanMetadata } from './types';

export interface PlanCacheConfig {
  keyPrefix?: string;
  defaultTtlSeconds?: number;
  onDegradation?: (message: string, context?: Record<string, unknown>) => void;
}

const PLAN_KEY_PREFIX = 'subtrackr:plan:';
const ACTIVE_LIST_KEY = 'active-list';

export class PlanCacheService {
  private readonly cache: RedisCacheService;
  private readonly defaultTtl: number;
  private readonly planPrefix: string;
  /** Single-flight: one DB load per plan id on concurrent cache misses. */
  private readonly inflight = new Map<string, Promise<PlanMetadata | null>>();
  private readonly activeListInflight = new Map<string, Promise<PlanMetadata[]>>();

  constructor(
    redis: RedisClient,
    private readonly repository: IPlanRepository,
    config: PlanCacheConfig = {},
    redisConfig: Pick<RedisConfig, 'defaultTtlSeconds'> = DEFAULT_REDIS_CONFIG,
  ) {
    this.defaultTtl = config.defaultTtlSeconds ?? redisConfig.defaultTtlSeconds;
    this.planPrefix = config.keyPrefix ?? PLAN_KEY_PREFIX;
    this.cache = new RedisCacheService(redis, {
      keyPrefix: this.planPrefix,
      defaultTtlSeconds: this.defaultTtl,
      onDegradation: config.onDegradation,
    });
  }

  private planKey(id: string): string {
    return `id:${id}`;
  }

  private resolveTtl(plan: PlanMetadata): number {
    const override = plan.metadata?.cacheTTL;
    if (typeof override === 'number' && override > 0) {
      return override;
    }
    return this.defaultTtl;
  }

  /**
   * Returns plan metadata by ID.
   * When Redis is degraded, queries the database directly.
   */
  async getPlan(id: string): Promise<PlanMetadata | null> {
    if (!this.cache.isDegraded()) {
      const cached = await this.cache.get(this.planKey(id));
      if (cached !== null) {
        return JSON.parse(cached) as PlanMetadata;
      }
    }

    const existing = this.inflight.get(id);
    if (existing) {
      return existing;
    }

    const flight = this.loadPlanFromDatabase(id);
    this.inflight.set(id, flight);

    try {
      return await flight;
    } finally {
      this.inflight.delete(id);
    }
  }

  /**
   * Returns all active plans, using a cached list when available.
   */
  async getActivePlans(): Promise<PlanMetadata[]> {
    if (!this.cache.isDegraded()) {
      const cached = await this.cache.get(ACTIVE_LIST_KEY);
      if (cached !== null) {
        return JSON.parse(cached) as PlanMetadata[];
      }
    }

    const existing = this.activeListInflight.get(ACTIVE_LIST_KEY);
    if (existing) {
      return existing;
    }

    const flight = this.loadActivePlansFromDatabase();
    this.activeListInflight.set(ACTIVE_LIST_KEY, flight);

    try {
      return await flight;
    } finally {
      this.activeListInflight.delete(ACTIVE_LIST_KEY);
    }
  }

  private async loadPlanFromDatabase(id: string): Promise<PlanMetadata | null> {
    const plan = await this.repository.findById(id);
    if (plan?.isActive) {
      await this.setPlan(plan);
    }
    return plan;
  }

  private async loadActivePlansFromDatabase(): Promise<PlanMetadata[]> {
    const plans = await this.repository.findAllActive();
    if (plans.length > 0 && !this.cache.isDegraded()) {
      await this.cache.set(ACTIVE_LIST_KEY, JSON.stringify(plans), this.defaultTtl);
      for (const plan of plans) {
        await this.setPlan(plan);
      }
    }
    return plans;
  }

  /** Writes plan metadata to Redis with plan-specific TTL. Returns false when Redis is down. */
  async setPlan(plan: PlanMetadata): Promise<boolean> {
    return this.cache.set(
      this.planKey(plan.id),
      JSON.stringify(plan),
      this.resolveTtl(plan),
    );
  }

  async invalidatePlan(id: string): Promise<void> {
    await this.cache.invalidate(this.planKey(id));
    await this.invalidateActiveList();
  }

  async invalidateAll(): Promise<void> {
    await this.cache.invalidateAll();
  }

  private async invalidateActiveList(): Promise<void> {
    await this.cache.invalidate(ACTIVE_LIST_KEY);
  }

  async writeThroughUpdate(
    id: string,
    input: Parameters<IPlanRepository['update']>[1],
  ): Promise<PlanMetadata | null> {
    const persisted = await this.repository.update(id, input);
    if (persisted) {
      if (persisted.isActive) {
        await this.setPlan(persisted);
      } else {
        await this.invalidatePlan(id);
      }
      await this.invalidateActiveList();
    } else {
      await this.invalidatePlan(id);
    }
    return persisted;
  }

  async writeThroughCreate(
    input: Parameters<IPlanRepository['create']>[0],
  ): Promise<PlanMetadata> {
    const persisted = await this.repository.create(input);
    await this.setPlan(persisted);
    await this.invalidateActiveList();
    return persisted;
  }

  async writeThroughDeactivate(id: string): Promise<PlanMetadata | null> {
    const persisted = await this.repository.deactivate(id);
    if (persisted) {
      await this.invalidatePlan(id);
      await this.invalidateActiveList();
    }
    return persisted;
  }

  async warmActivePlans(): Promise<{ warmed: number; errors: number }> {
    let warmed = 0;
    let errors = 0;

    const healthy = await this.cache.isHealthy();
    if (!healthy) {
      return { warmed: 0, errors: 1 };
    }

    const plans = await this.repository.findAllActive();

    for (const plan of plans) {
      const ok = await this.setPlan(plan);
      if (ok) {
        warmed++;
      } else {
        errors++;
      }
    }

    if (plans.length > 0) {
      const listOk = await this.cache.set(
        ACTIVE_LIST_KEY,
        JSON.stringify(plans),
        this.defaultTtl,
      );
      if (!listOk) {
        errors++;
      }
    }

    return { warmed, errors };
  }

  getMetrics() {
    return this.cache.getMetrics();
  }

  prometheusMetrics(): string {
    return this.cache.prometheusMetrics('subtrackr_plan_cache');
  }

  async isHealthy(): Promise<boolean> {
    return this.cache.isHealthy();
  }

  isDegraded(): boolean {
    return this.cache.isDegraded();
  }
}
