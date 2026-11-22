/**
 * mock-infrastructure.ts
 *
 * Issue #1180 — Build integration test framework with mocks
 *
 * Centralised mock infrastructure for integration tests.
 * Provides:
 *  - InMemoryAsyncStorage        — drop-in AsyncStorage that works without RN
 *  - MockNetworkMonitor          — online/offline toggle
 *  - MockNotificationService     — captures scheduled notifications
 *  - MockStellarClient           — simulates Soroban RPC responses
 *  - MockApiClient               — captures outbound HTTP calls
 *  - TestIntegrationHarness      — one-stop setup / teardown wrapper
 *
 * Usage:
 *   import { createTestHarness } from './mock-infrastructure';
 *
 *   describe('my integration', () => {
 *     const harness = createTestHarness();
 *     beforeEach(() => harness.setUp());
 *     afterEach(() => harness.tearDown());
 *
 *     it('does something', async () => {
 *       harness.network.goOffline();
 *       harness.notifications.assertScheduledCount(0);
 *     });
 *   });
 */

import { jest } from '@jest/globals';

// ══════════════════════════════════════════════════════════════════════════════
// 1. In-memory AsyncStorage
// ══════════════════════════════════════════════════════════════════════════════

/** Minimal AsyncStorage-compatible interface. */
export interface AsyncStorageInterface {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
  multiGet(keys: string[]): Promise<[string, string | null][]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}

export class InMemoryAsyncStorage implements AsyncStorageInterface {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async getAllKeys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map((k) => [k, this.store.get(k) ?? null]);
  }

  async multiSet(pairs: [string, string][]): Promise<void> {
    for (const [key, value] of pairs) {
      this.store.set(key, value);
    }
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  /** Number of keys currently stored — useful for assertions. */
  get size(): number {
    return this.store.size;
  }

  /** Snapshot the current store as a plain object for snapshot testing. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }

  /** Seed the store from a plain object. */
  seed(data: Record<string, string>): void {
    for (const [k, v] of Object.entries(data)) {
      this.store.set(k, v);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Mock Network Monitor
// ══════════════════════════════════════════════════════════════════════════════

export type NetworkEventListener = (isOnline: boolean) => void;

export class MockNetworkMonitor {
  private _isOnline = true;
  private listeners: NetworkEventListener[] = [];

  get isOnline(): boolean {
    return this._isOnline;
  }

  goOnline(): void {
    this._isOnline = true;
    this.listeners.forEach((fn) => fn(true));
  }

  goOffline(): void {
    this._isOnline = false;
    this.listeners.forEach((fn) => fn(false));
  }

  addListener(fn: NetworkEventListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  reset(): void {
    this._isOnline = true;
    this.listeners = [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Mock Notification Service
// ══════════════════════════════════════════════════════════════════════════════

export interface CapturedNotification {
  title: string;
  body: string;
  data: Record<string, unknown>;
  trigger: unknown;
  scheduledAt: Date;
}

export class MockNotificationService {
  private _scheduled: CapturedNotification[] = [];
  private _cancelled: string[] = [];
  private _permissionStatus: 'granted' | 'denied' | 'undetermined' = 'granted';

  /** Simulate scheduling a notification — mirrors Expo Notifications API shape. */
  async scheduleNotificationAsync(payload: {
    content: { title: string; body: string; data?: Record<string, unknown>; sound?: unknown };
    trigger: unknown;
  }): Promise<string> {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this._scheduled.push({
      title: payload.content.title,
      body: payload.content.body,
      data: payload.content.data ?? {},
      trigger: payload.trigger,
      scheduledAt: new Date(),
    });
    return id;
  }

  async cancelScheduledNotificationAsync(id: string): Promise<void> {
    this._cancelled.push(id);
  }

  async getAllScheduledNotificationsAsync(): Promise<CapturedNotification[]> {
    return [...this._scheduled];
  }

  async getPermissionsAsync(): Promise<{ status: string }> {
    return { status: this._permissionStatus };
  }

  async requestPermissionsAsync(): Promise<{ status: string }> {
    return { status: this._permissionStatus };
  }

  // ── Assertion helpers ────────────────────────────────────────────────────

  get scheduled(): CapturedNotification[] {
    return [...this._scheduled];
  }

  get cancelled(): string[] {
    return [...this._cancelled];
  }

  assertScheduledCount(expected: number): void {
    if (this._scheduled.length !== expected) {
      throw new Error(
        `Expected ${expected} scheduled notification(s), but found ${this._scheduled.length}`
      );
    }
  }

  assertLastTitleContains(substring: string): void {
    const last = this._scheduled[this._scheduled.length - 1];
    if (!last) throw new Error('No notifications have been scheduled');
    if (!last.title.includes(substring)) {
      throw new Error(`Expected last notification title to contain "${substring}", got "${last.title}"`);
    }
  }

  assertDataType(index: number, type: string): void {
    const notif = this._scheduled[index];
    if (!notif) throw new Error(`No notification at index ${index}`);
    if ((notif.data as { type?: string }).type !== type) {
      throw new Error(
        `Expected data.type "${type}", got "${(notif.data as { type?: string }).type}"`
      );
    }
  }

  denyPermission(): void {
    this._permissionStatus = 'denied';
  }

  grantPermission(): void {
    this._permissionStatus = 'granted';
  }

  reset(): void {
    this._scheduled = [];
    this._cancelled = [];
    this._permissionStatus = 'granted';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Mock Stellar / Soroban Client
// ══════════════════════════════════════════════════════════════════════════════

export interface StellarInvokeResult {
  success: boolean;
  result?: unknown;
  error?: string;
  ledger?: number;
}

export type StellarContractHandler = (
  method: string,
  args: unknown[]
) => Promise<StellarInvokeResult>;

export class MockStellarClient {
  private handlers = new Map<string, StellarContractHandler>();
  private _calls: Array<{ method: string; args: unknown[]; at: Date }> = [];

  /** Register a handler for a specific contract method. */
  onMethod(method: string, handler: StellarContractHandler): void {
    this.handlers.set(method, handler);
  }

  /** Invoke a contract method (called by services under test). */
  async invoke(method: string, args: unknown[]): Promise<StellarInvokeResult> {
    this._calls.push({ method, args, at: new Date() });
    const handler = this.handlers.get(method);
    if (!handler) {
      // Default: always succeed with null result
      return { success: true, result: null, ledger: 1000 };
    }
    return handler(method, args);
  }

  /** Simulate a Soroban subscription creation response. */
  simulateSubscribeSuccess(subscriptionId = 1): void {
    this.onMethod('subscribe', async () => ({
      success: true,
      result: subscriptionId,
      ledger: 1001,
    }));
  }

  /** Simulate a failed contract call. */
  simulateFailure(method: string, reason = 'Contract execution failed'): void {
    this.onMethod(method, async () => ({
      success: false,
      error: reason,
    }));
  }

  /** Simulate a Soroban balance check. */
  simulateBalance(balance: string): void {
    this.onMethod('balanceOf', async () => ({
      success: true,
      result: balance,
      ledger: 1001,
    }));
  }

  get calls(): Array<{ method: string; args: unknown[]; at: Date }> {
    return [...this._calls];
  }

  callsFor(method: string): Array<{ method: string; args: unknown[]; at: Date }> {
    return this._calls.filter((c) => c.method === method);
  }

  assertCalled(method: string, times?: number): void {
    const n = this.callsFor(method).length;
    if (times !== undefined && n !== times) {
      throw new Error(`Expected "${method}" to be called ${times} time(s), but was called ${n} time(s)`);
    }
    if (times === undefined && n === 0) {
      throw new Error(`Expected "${method}" to be called at least once, but was never called`);
    }
  }

  assertNeverCalled(method: string): void {
    const n = this.callsFor(method).length;
    if (n > 0) {
      throw new Error(`Expected "${method}" to never be called, but was called ${n} time(s)`);
    }
  }

  reset(): void {
    this.handlers.clear();
    this._calls = [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Mock API Client
// ══════════════════════════════════════════════════════════════════════════════

export interface CapturedRequest {
  method: string;
  endpoint: string;
  body: unknown;
  headers: Record<string, string>;
  at: Date;
}

export interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class MockApiClient {
  private handlers = new Map<string, MockResponse | ((req: CapturedRequest) => MockResponse)>();
  private _requests: CapturedRequest[] = [];

  /** Register a static or dynamic response for a method+endpoint combination. */
  on(
    method: string,
    endpoint: string,
    response: MockResponse | ((req: CapturedRequest) => MockResponse)
  ): void {
    this.handlers.set(`${method.toUpperCase()}:${endpoint}`, response);
  }

  /** Simulate an outbound request — called by the SDK / apiClient under test. */
  async request<T>(
    endpoint: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const req: CapturedRequest = {
      method: method.toUpperCase(),
      endpoint,
      body,
      headers,
      at: new Date(),
    };
    this._requests.push(req);

    const key = `${method.toUpperCase()}:${endpoint}`;
    const handler = this.handlers.get(key);

    if (!handler) {
      // Default 200 with empty body
      return undefined as unknown as T;
    }

    const response = typeof handler === 'function' ? handler(req) : handler;

    if (response.status >= 400) {
      const err = new Error((response.body as { message?: string })?.message ?? 'Request failed');
      (err as unknown as Record<string, unknown>)['statusCode'] = response.status;
      throw err;
    }

    return response.body as T;
  }

  get requests(): CapturedRequest[] {
    return [...this._requests];
  }

  requestsTo(endpoint: string): CapturedRequest[] {
    return this._requests.filter((r) => r.endpoint === endpoint);
  }

  assertRequested(method: string, endpoint: string, times?: number): void {
    const n = this._requests.filter(
      (r) => r.method === method.toUpperCase() && r.endpoint === endpoint
    ).length;
    if (times !== undefined && n !== times) {
      throw new Error(
        `Expected ${times} request(s) to ${method} ${endpoint}, found ${n}`
      );
    }
    if (times === undefined && n === 0) {
      throw new Error(`Expected at least one request to ${method} ${endpoint}, found none`);
    }
  }

  reset(): void {
    this.handlers.clear();
    this._requests = [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Jest mock-factory helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns a jest.fn() that resolves to `value`.
 * Typed to avoid `any` casts in test files.
 */
export function mockResolve<T>(value: T): jest.MockedFunction<() => Promise<T>> {
  return jest.fn(() => Promise.resolve(value)) as jest.MockedFunction<() => Promise<T>>;
}

/** Returns a jest.fn() that rejects with `error`. */
export function mockReject(error: string | Error): jest.MockedFunction<() => Promise<never>> {
  const err = typeof error === 'string' ? new Error(error) : error;
  return jest.fn(() => Promise.reject(err)) as jest.MockedFunction<() => Promise<never>>;
}

/** Creates a spy on every own-function property of `module`. */
export function spyOnModule<T extends Record<string, unknown>>(
  module: T
): Record<keyof T, jest.SpyInstance> {
  const spies = {} as Record<keyof T, jest.SpyInstance>;
  for (const key of Object.keys(module) as Array<keyof T>) {
    if (typeof module[key] === 'function') {
      spies[key] = jest.spyOn(module as Record<string, unknown>, key as string) as jest.SpyInstance;
    }
  }
  return spies;
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. TestIntegrationHarness — one-stop setup / teardown
// ══════════════════════════════════════════════════════════════════════════════

export interface TestIntegrationHarness {
  storage: InMemoryAsyncStorage;
  network: MockNetworkMonitor;
  notifications: MockNotificationService;
  stellar: MockStellarClient;
  api: MockApiClient;
  /** Call in beforeEach — sets up fake timers and clears all mocks. */
  setUp(): void;
  /** Call in afterEach — runs pending timers and restores real timers. */
  tearDown(): void;
  /** Advance fake timers and flush all pending promises. */
  tick(ms?: number): Promise<void>;
}

/**
 * Factory that creates a fresh harness instance.
 *
 * @example
 * const harness = createTestHarness();
 * beforeEach(() => harness.setUp());
 * afterEach(() => harness.tearDown());
 */
export function createTestHarness(): TestIntegrationHarness {
  const storage = new InMemoryAsyncStorage();
  const network = new MockNetworkMonitor();
  const notifications = new MockNotificationService();
  const stellar = new MockStellarClient();
  const api = new MockApiClient();

  return {
    storage,
    network,
    notifications,
    stellar,
    api,

    setUp() {
      jest.useFakeTimers();
      storage.clear();
      network.reset();
      notifications.reset();
      stellar.reset();
      api.reset();
    },

    tearDown() {
      jest.runAllTimers();
      jest.useRealTimers();
    },

    async tick(ms = 0): Promise<void> {
      if (ms > 0) jest.advanceTimersByTime(ms);
      // Flush micro-task queue
      await Promise.resolve();
    },
  };
}
