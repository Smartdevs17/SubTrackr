/**
 * testContainer.ts — Test container and fixture infrastructure for backend integration tests.
 *
 * Provides:
 *  - TestContainerManager: lifecycle management (start/stop/seed/clean/snapshot/restore)
 *  - FixtureLoader: typed fixture factories for subscriptions, plans, users, merchants, invoices
 *  - FlakyTestDetector: retry-based flakiness detection
 *  - TestClock: deterministic time control for time-sensitive tests
 *  - TestEventBus: in-memory event capture for integration assertions
 *  - DatabaseSeeder: declarative seed helper with dependency ordering
 *  - RedisFixture: Redis key management with auto-cleanup
 *  - PerformanceAssertion: timing assertions with configurable thresholds
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestContainerConfig {
  /** PostgreSQL port (default: 5432 or env PG_PORT) */
  dbPort?: number;
  /** Redis port (default: 6379 or env REDIS_PORT) */
  redisPort?: number;
  /** Container image to use */
  image?: string;
  /** Whether to use an isolated in-memory store (default: true for unit tests) */
  inMemory?: boolean;
  /** Auto-rollback each test via savepoint (default: true) */
  autoRollback?: boolean;
  /** Seed data to load on start */
  initialSeed?: SeedData;
}

export interface SeedData {
  plans?: PlanFixture[];
  users?: UserFixture[];
  subscriptions?: SubscriptionFixture[];
  merchants?: MerchantFixture[];
  invoices?: InvoiceFixture[];
  [entity: string]: Record<string, unknown>[] | undefined;
}

export interface PlanFixture {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'monthly' | 'yearly' | 'weekly';
  merchantId?: string;
  active?: boolean;
  createdAt?: string;
}

export interface UserFixture {
  id: string;
  email: string;
  address?: string;
  createdAt?: string;
}

export interface SubscriptionFixture {
  id: string;
  userId: string;
  planId: string;
  status: 'active' | 'cancelled' | 'paused' | 'past_due';
  startedAt?: string;
  nextBillingAt?: string;
  amount?: number;
  currency?: string;
}

export interface MerchantFixture {
  id: string;
  name: string;
  email: string;
  address?: string;
  active?: boolean;
}

export interface InvoiceFixture {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'voided';
  dueAt?: string;
  paidAt?: string | null;
}

export interface ContainerSnapshot {
  id: string;
  takenAt: number;
  data: SeedData;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

type EntityStore = Map<string, Map<string, Record<string, unknown>>>;

function storeSet(store: EntityStore, entity: string, id: string, value: Record<string, unknown>): void {
  if (!store.has(entity)) store.set(entity, new Map());
  store.get(entity)!.set(id, value);
}

function storeGet(store: EntityStore, entity: string, id: string): Record<string, unknown> | undefined {
  return store.get(entity)?.get(id);
}

function storeGetAll(store: EntityStore, entity: string): Record<string, unknown>[] {
  return Array.from(store.get(entity)?.values() ?? []);
}

function storeClear(store: EntityStore, entity?: string): void {
  if (entity) {
    store.get(entity)?.clear();
  } else {
    store.clear();
  }
}

// ─── TestContainerManager ─────────────────────────────────────────────────────

/**
 * Manages test environment lifecycle and provides fixture helpers.
 *
 * Uses a fast in-memory store by default (inMemory: true).
 * When inMemory is false, real containers are assumed to be running via
 * environment-configured connection strings (PG_PORT, REDIS_PORT).
 */
export class TestContainerManager {
  private isRunning = false;
  private store: EntityStore = new Map();
  private snapshots: Map<string, ContainerSnapshot> = new Map();
  private savepointStack: SeedData[] = [];
  readonly config: Required<TestContainerConfig>;

  constructor(config: TestContainerConfig = {}) {
    this.config = {
      dbPort: config.dbPort ?? Number(process.env['PG_PORT'] ?? 5432),
      redisPort: config.redisPort ?? Number(process.env['REDIS_PORT'] ?? 6379),
      image: config.image ?? 'postgres:15-alpine',
      inMemory: config.inMemory ?? true,
      autoRollback: config.autoRollback ?? true,
      initialSeed: config.initialSeed ?? {},
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async startContainer(): Promise<void> {
    if (this.isRunning) return;
    this.store = new Map();
    this.snapshots.clear();
    this.savepointStack = [];
    this.isRunning = true;
    if (Object.keys(this.config.initialSeed).length > 0) {
      await this.seedDatabase(this.config.initialSeed);
    }
  }

  async stopContainer(): Promise<void> {
    this.isRunning = false;
    this.store = new Map();
    this.snapshots.clear();
    this.savepointStack = [];
  }

  isContainerActive(): boolean {
    return this.isRunning;
  }

  // ── Seeding ─────────────────────────────────────────────────────────────────

  async seedDatabase(seedData: SeedData): Promise<void> {
    if (!this.isRunning) throw new Error('TestContainerManager: container is not running');
    for (const [entity, rows] of Object.entries(seedData)) {
      if (!rows) continue;
      for (const row of rows) {
        const id = row['id'] as string;
        if (!id) throw new Error(`Seed row in "${entity}" is missing required "id" field`);
        storeSet(this.store, entity, id, { ...row });
      }
    }
  }

  async cleanDatabase(entities?: string[]): Promise<void> {
    if (!this.isRunning) return;
    if (entities) {
      for (const e of entities) storeClear(this.store, e);
    } else {
      storeClear(this.store);
    }
  }

  // ── Savepoints (per-test isolation) ─────────────────────────────────────────

  async createSavepoint(): Promise<void> {
    const snap: SeedData = {};
    for (const [entity, entityMap] of this.store) {
      snap[entity] = Array.from(entityMap.values()) as Record<string, unknown>[];
    }
    this.savepointStack.push(snap);
  }

  async rollbackToSavepoint(): Promise<void> {
    const snap = this.savepointStack.pop();
    if (!snap) return;
    storeClear(this.store);
    if (Object.keys(snap).length > 0) await this.seedDatabase(snap);
  }

  // ── Named snapshots ─────────────────────────────────────────────────────────

  takeSnapshot(id: string): ContainerSnapshot {
    const data: SeedData = {};
    for (const [entity, entityMap] of this.store) {
      data[entity] = Array.from(entityMap.values()) as Record<string, unknown>[];
    }
    const snap: ContainerSnapshot = { id, takenAt: Date.now(), data };
    this.snapshots.set(id, snap);
    return snap;
  }

  async restoreSnapshot(id: string): Promise<void> {
    const snap = this.snapshots.get(id);
    if (!snap) throw new Error(`TestContainerManager: snapshot "${id}" not found`);
    storeClear(this.store);
    await this.seedDatabase(snap.data);
  }

  getSnapshot(id: string): ContainerSnapshot | undefined {
    return this.snapshots.get(id);
  }

  // ── Query helpers ───────────────────────────────────────────────────────────

  findById<T extends Record<string, unknown>>(entity: string, id: string): T | undefined {
    return storeGet(this.store, entity, id) as T | undefined;
  }

  findAll<T extends Record<string, unknown>>(entity: string): T[] {
    return storeGetAll(this.store, entity) as T[];
  }

  findWhere<T extends Record<string, unknown>>(entity: string, predicate: (row: T) => boolean): T[] {
    return this.findAll<T>(entity).filter(predicate);
  }

  upsert<T extends Record<string, unknown>>(entity: string, row: T): T {
    const id = row['id'] as string;
    if (!id) throw new Error(`upsert: missing id in entity "${entity}"`);
    storeSet(this.store, entity, id, row);
    return row;
  }

  delete(entity: string, id: string): boolean {
    return this.store.get(entity)?.delete(id) ?? false;
  }

  count(entity: string): number {
    return this.store.get(entity)?.size ?? 0;
  }
}

export const testContainerManager = new TestContainerManager();

// ─── FixtureLoader ────────────────────────────────────────────────────────────

let _fixtureCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}_${String(++_fixtureCounter).padStart(4, '0')}`;
}

/**
 * Typed fixture factory. Uses sensible defaults so tests only specify what matters.
 */
export class FixtureLoader {
  static resetCounter(): void {
    _fixtureCounter = 0;
  }

  static plan(overrides: Partial<PlanFixture> = {}): PlanFixture {
    return {
      id: nextId('plan'),
      name: 'Test Plan',
      price: 9.99,
      currency: 'USD',
      interval: 'monthly',
      merchantId: 'merchant_default',
      active: true,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static user(overrides: Partial<UserFixture> = {}): UserFixture {
    const id = overrides.id ?? nextId('user');
    return {
      id,
      email: `${id}@test.example`,
      address: `GTEST${id.toUpperCase().slice(0, 51).padEnd(51, 'A')}`,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static subscription(overrides: Partial<SubscriptionFixture> = {}): SubscriptionFixture {
    return {
      id: nextId('sub'),
      userId: nextId('user'),
      planId: nextId('plan'),
      status: 'active',
      startedAt: new Date().toISOString(),
      nextBillingAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      amount: 9.99,
      currency: 'USD',
      ...overrides,
    };
  }

  static merchant(overrides: Partial<MerchantFixture> = {}): MerchantFixture {
    const id = overrides.id ?? nextId('merchant');
    return {
      id,
      name: `Test Merchant ${id}`,
      email: `${id}@merchant.example`,
      active: true,
      ...overrides,
    };
  }

  static invoice(overrides: Partial<InvoiceFixture> = {}): InvoiceFixture {
    return {
      id: nextId('inv'),
      subscriptionId: nextId('sub'),
      amount: 9.99,
      currency: 'USD',
      status: 'pending',
      dueAt: new Date().toISOString(),
      paidAt: null,
      ...overrides,
    };
  }

  /** Build a fully related scenario: merchant → plan → user → subscription → invoice */
  static fullSubscriptionScenario(overrides: {
    plan?: Partial<PlanFixture>;
    user?: Partial<UserFixture>;
    subscription?: Partial<SubscriptionFixture>;
    merchant?: Partial<MerchantFixture>;
    invoice?: Partial<InvoiceFixture>;
  } = {}) {
    const merchant = FixtureLoader.merchant(overrides.merchant);
    const plan = FixtureLoader.plan({ merchantId: merchant.id, ...overrides.plan });
    const user = FixtureLoader.user(overrides.user);
    const subscription = FixtureLoader.subscription({
      userId: user.id,
      planId: plan.id,
      amount: plan.price,
      currency: plan.currency,
      ...overrides.subscription,
    });
    const invoice = FixtureLoader.invoice({
      subscriptionId: subscription.id,
      amount: subscription.amount,
      currency: subscription.currency,
      ...overrides.invoice,
    });
    return { merchant, plan, user, subscription, invoice };
  }
}

// ─── FlakyTestDetector ────────────────────────────────────────────────────────

export interface FlakyTestResult {
  isFlaky: boolean;
  passed: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

/**
 * Execute a test function multiple times and report whether it is flaky.
 * Flaky = passes at least once AND fails at least once across iterations.
 */
export async function detectFlakyTest(
  testFn: () => Promise<void> | void,
  iterations = 3,
): Promise<FlakyTestResult> {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    try {
      await testFn();
      passed++;
    } catch (err) {
      failed++;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    isFlaky: passed > 0 && failed > 0,
    passed,
    failed,
    errors,
    durationMs: Date.now() - start,
  };
}

// ─── TestClock ────────────────────────────────────────────────────────────────

/**
 * Deterministic clock for time-sensitive tests.
 * Inject `clock.now()` into services instead of `Date.now()`.
 */
export class TestClock {
  private _time: number;

  constructor(initialTime?: number) {
    this._time = initialTime ?? Date.now();
  }

  now(): number { return this._time; }
  date(): Date { return new Date(this._time); }
  iso(): string { return new Date(this._time).toISOString(); }

  advance(ms: number): this { this._time += ms; return this; }
  advanceHours(h: number): this { return this.advance(h * 3_600_000); }
  advanceDays(d: number): this { return this.advance(d * 86_400_000); }

  set(time: number | string | Date): this {
    this._time = new Date(time).getTime();
    return this;
  }

  reset(time?: number): this {
    this._time = time ?? Date.now();
    return this;
  }
}

// ─── TestEventBus ─────────────────────────────────────────────────────────────

export interface CapturedEvent<T = unknown> {
  name: string;
  payload: T;
  timestamp: number;
}

/**
 * In-memory event capture bus. Records every published event so integration
 * tests can assert what was emitted without real messaging infrastructure.
 */
export class TestEventBus {
  private events: CapturedEvent[] = [];

  publish<T>(name: string, payload: T): void {
    this.events.push({ name, payload, timestamp: Date.now() });
  }

  all(): CapturedEvent[] { return [...this.events]; }

  ofType<T>(name: string): CapturedEvent<T>[] {
    return this.events.filter((e) => e.name === name) as CapturedEvent<T>[];
  }

  last<T>(name: string): CapturedEvent<T> | undefined {
    const m = this.ofType<T>(name);
    return m[m.length - 1];
  }

  count(name?: string): number {
    return name ? this.events.filter((e) => e.name === name).length : this.events.length;
  }

  assertPublished(name: string): void {
    if (this.count(name) === 0) {
      throw new Error(`TestEventBus: expected event "${name}" to be published`);
    }
  }

  assertNotPublished(name: string): void {
    const n = this.count(name);
    if (n > 0) {
      throw new Error(`TestEventBus: expected event "${name}" NOT to be published (was published ${n}x)`);
    }
  }

  clear(): void { this.events = []; }
}

// ─── DatabaseSeeder ───────────────────────────────────────────────────────────

/**
 * Fluent declarative seeder — inserts entities in dependency order
 * (merchants → plans → users → subscriptions → invoices).
 */
export class DatabaseSeeder {
  private data: SeedData = {};

  withMerchants(rows: MerchantFixture[]): this {
    this.data.merchants = [...(this.data.merchants ?? []), ...rows];
    return this;
  }
  withPlans(rows: PlanFixture[]): this {
    this.data.plans = [...(this.data.plans ?? []), ...rows];
    return this;
  }
  withUsers(rows: UserFixture[]): this {
    this.data.users = [...(this.data.users ?? []), ...rows];
    return this;
  }
  withSubscriptions(rows: SubscriptionFixture[]): this {
    this.data.subscriptions = [...(this.data.subscriptions ?? []), ...rows];
    return this;
  }
  withInvoices(rows: InvoiceFixture[]): this {
    this.data.invoices = [...(this.data.invoices ?? []), ...rows];
    return this;
  }
  withRaw(entity: string, rows: Record<string, unknown>[]): this {
    this.data[entity] = [...((this.data[entity] as Record<string, unknown>[]) ?? []), ...rows];
    return this;
  }

  build(): SeedData {
    const order: (keyof SeedData)[] = ['merchants', 'plans', 'users', 'subscriptions', 'invoices'];
    const ordered: SeedData = {};
    for (const k of order) {
      if (this.data[k]?.length) ordered[k] = this.data[k];
    }
    for (const [k, v] of Object.entries(this.data)) {
      if (!order.includes(k as keyof SeedData) && (v as unknown[])?.length) ordered[k] = v;
    }
    return ordered;
  }

  async seedInto(manager: TestContainerManager): Promise<void> {
    await manager.seedDatabase(this.build());
  }
}

// ─── RedisFixture ─────────────────────────────────────────────────────────────

export interface RedisClient {
  set(key: string, value: string, expiryMode?: string, time?: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Tracks Redis keys created during a test and batch-deletes them on cleanup.
 */
export class RedisFixture {
  private trackedKeys = new Set<string>();
  constructor(private client: RedisClient) {}

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.trackedKeys.add(key);
    if (ttlSeconds != null) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> { return this.client.get(key); }

  async cleanup(): Promise<void> {
    const keys = Array.from(this.trackedKeys);
    if (keys.length > 0) await this.client.del(...keys);
    this.trackedKeys.clear();
  }

  async cleanupPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) await this.client.del(...keys);
  }

  trackedCount(): number { return this.trackedKeys.size; }
}

// ─── Performance helpers ──────────────────────────────────────────────────────

export interface TimingResult<T> {
  result: T;
  durationMs: number;
}

export async function withTiming<T>(fn: () => Promise<T> | T): Promise<TimingResult<T>> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

export function assertWithinMs(durationMs: number, limitMs: number, label = 'operation'): void {
  if (durationMs > limitMs) {
    throw new Error(
      `Performance assertion failed: ${label} took ${durationMs}ms, limit was ${limitMs}ms`,
    );
  }
}

// ─── createTestContext ────────────────────────────────────────────────────────

export interface TestContext {
  container: TestContainerManager;
  fixtures: typeof FixtureLoader;
  clock: TestClock;
  events: TestEventBus;
  seeder: DatabaseSeeder;
}

/**
 * Convenience factory that creates all test infrastructure in one call.
 *
 * @example
 * const ctx = createTestContext();
 * beforeAll(() => ctx.container.startContainer());
 * afterAll(() => ctx.container.stopContainer());
 * beforeEach(() => ctx.container.createSavepoint());
 * afterEach(() => ctx.container.rollbackToSavepoint());
 */
export function createTestContext(config: TestContainerConfig = {}): TestContext {
  return {
    container: new TestContainerManager(config),
    fixtures: FixtureLoader,
    clock: new TestClock(),
    events: new TestEventBus(),
    seeder: new DatabaseSeeder(),
  };
}
