/**
 * JobScheduler — cron-based job scheduling on top of WeightedFairQueue.
 *
 * Registers cron expressions against job factories and fires them at the
 * appropriate time. Uses a polling ticker (setInterval) rather than a full
 * cron daemon so it runs in-process without external dependencies.
 *
 * Cron expression format: "second minute hour day-of-month month day-of-week"
 * (6-field format compatible with node-cron / standard cron).
 *
 * Usage:
 *   const scheduler = new JobScheduler(weightedFairQueue, { tickMs: 1000 });
 *   scheduler.register({
 *     name: 'daily-revenue-recognition',
 *     cron: '0 0 2 * * *',       // 2:00 AM daily
 *     priority: 'normal',
 *     jobName: 'billing:revenue-recognition',
 *     dataFactory: () => ({ runDate: new Date().toISOString() }),
 *   });
 *   scheduler.start();
 */

import type { WeightedFairQueue } from './weightedFairQueue';
import type { PriorityClass } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CronJobDefinition<T = unknown> {
  /** Unique name for this scheduled job. */
  name: string;
  /**
   * Cron expression (6-field: seconds minutes hours day month weekday).
   * Examples:
   *   '0 * * * * *'    — every minute
   *   '0 0 2 * * *'    — daily at 2:00 AM
   *   '0 0 * * * 1'    — every Monday at midnight
   *   '0 30 9 1 * *'   — 9:30 AM on the 1st of every month
   */
  cron: string;
  priority: PriorityClass;
  jobName: string;
  /** Factory that produces the job payload at fire time. */
  dataFactory: () => T;
  /** Optional description for monitoring dashboards. */
  description?: string;
  /** When true, the job is skipped if the previous run hasn't completed. Default: false. */
  skipIfRunning?: boolean;
}

export interface ScheduledJobStatus {
  name: string;
  cron: string;
  priority: PriorityClass;
  jobName: string;
  description: string;
  nextFireAt: number | null;
  lastFiredAt: number | null;
  fireCount: number;
  skipCount: number;
}

// ── Minimal cron matcher ──────────────────────────────────────────────────────

/**
 * Parse a 6-field cron expression into its parts.
 * Returns null on parse error.
 */
function parseCron(expr: string): string[] | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 6) return null;
  return parts;
}

/**
 * Returns true if the given Date matches the cron parts.
 * Supports '*', exact values, comma-separated lists, and ranges (a-b).
 */
function matchesCron(parts: string[], d: Date): boolean {
  const values = [
    d.getSeconds(),
    d.getMinutes(),
    d.getHours(),
    d.getDate(),
    d.getMonth() + 1,
    d.getDay(),
  ];

  for (let i = 0; i < 6; i++) {
    const part = parts[i] ?? '*';
    if (part === '*') continue;

    const fieldValue = values[i]!;
    const segments = part.split(',');
    let matched = false;

    for (const seg of segments) {
      if (seg.includes('-')) {
        const [from, to] = seg.split('-').map(Number);
        if (!Number.isNaN(from) && !Number.isNaN(to) && fieldValue >= from! && fieldValue <= to!) {
          matched = true;
          break;
        }
      } else if (seg.includes('/')) {
        const [rangeStr, stepStr] = seg.split('/');
        const step = Number(stepStr);
        if (rangeStr === '*') {
          if (!Number.isNaN(step) && fieldValue % step === 0) {
            matched = true;
            break;
          }
        }
      } else {
        const num = Number(seg);
        if (!Number.isNaN(num) && fieldValue === num) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) return false;
  }

  return true;
}

// ── JobScheduler ──────────────────────────────────────────────────────────────

interface ScheduledEntry<T = unknown> {
  definition: CronJobDefinition<T>;
  parts: string[];
  lastFiredAt: number | null;
  fireCount: number;
  skipCount: number;
  running: boolean;
}

export interface JobSchedulerOptions {
  /** Polling interval in ms. Default: 1000 (1 second). */
  tickMs?: number;
  /** Injectable clock. Default: Date.now. */
  now?: () => number;
}

export class JobScheduler {
  private readonly queue: WeightedFairQueue;
  private readonly tickMs: number;
  private readonly nowFn: () => number;
  private readonly entries = new Map<string, ScheduledEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(queue: WeightedFairQueue, options: JobSchedulerOptions = {}) {
    this.queue = queue;
    this.tickMs = options.tickMs ?? 1_000;
    this.nowFn = options.now ?? Date.now;
  }

  /**
   * Register a cron job. Overwrites any existing registration with the same name.
   * Returns false if the cron expression is invalid.
   */
  register<T>(definition: CronJobDefinition<T>): boolean {
    const parts = parseCron(definition.cron);
    if (!parts) {
      console.warn(`[JobScheduler] Invalid cron expression "${definition.cron}" for job "${definition.name}"`);
      return false;
    }
    this.entries.set(definition.name, {
      definition: definition as CronJobDefinition<unknown>,
      parts,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      running: false,
    });
    return true;
  }

  /** Unregister a cron job by name. */
  unregister(name: string): void {
    this.entries.delete(name);
  }

  /** Start the scheduler tick. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Manually fire a named job regardless of cron schedule. Useful for testing. */
  async fireNow(name: string): Promise<boolean> {
    const entry = this.entries.get(name);
    if (!entry) return false;
    await this.fireJob(entry);
    return true;
  }

  private async tick(): Promise<void> {
    const now = this.nowFn();
    const d = new Date(now);
    // Normalise to second boundary to avoid sub-second jitter firing multiple times
    d.setMilliseconds(0);

    for (const entry of this.entries.values()) {
      if (!matchesCron(entry.parts, d)) continue;

      // Debounce: don't fire twice in the same second
      const lastSec = entry.lastFiredAt ? Math.floor(entry.lastFiredAt / 1_000) : -1;
      const thisSec = Math.floor(now / 1_000);
      if (lastSec === thisSec) continue;

      await this.fireJob(entry);
    }
  }

  private async fireJob(entry: ScheduledEntry): Promise<void> {
    if (entry.definition.skipIfRunning && entry.running) {
      entry.skipCount += 1;
      console.warn(`[JobScheduler] Skipping "${entry.definition.name}" — previous run still active`);
      return;
    }

    entry.running = true;
    entry.lastFiredAt = this.nowFn();
    entry.fireCount += 1;

    try {
      const data = entry.definition.dataFactory();
      await this.queue.enqueue(
        entry.definition.priority,
        entry.definition.jobName,
        data,
      );
    } catch (err) {
      console.error(`[JobScheduler] Failed to enqueue "${entry.definition.name}":`, err);
    } finally {
      entry.running = false;
    }
  }

  /** Get status of all registered jobs. */
  getStatus(): ScheduledJobStatus[] {
    return [...this.entries.entries()].map(([name, entry]) => ({
      name,
      cron: entry.definition.cron,
      priority: entry.definition.priority,
      jobName: entry.definition.jobName,
      description: entry.definition.description ?? '',
      nextFireAt: null, // Next-fire computation is a nice-to-have; omitted for simplicity
      lastFiredAt: entry.lastFiredAt,
      fireCount: entry.fireCount,
      skipCount: entry.skipCount,
    }));
  }
}
