/**
 * BillingEventStream — Stream Processing for Billing Domain Events
 *
 * Subscribes to all billing.* events on the shared EventBus and dispatches
 * them in configurable batches to registered BillingStreamConsumers.
 *
 * Design principles:
 *  - Single subscription to the EventBus (wildcard + domain filter)
 *  - In-memory ring buffer with configurable batch size and flush interval
 *  - Pause / resume / drain lifecycle for graceful shutdown
 *  - Consumer errors are isolated — one consumer failing does not stop others
 *  - Metrics available for observability
 *
 * Usage:
 * ```ts
 * const stream = new BillingEventStream({ batchSize: 20, flushIntervalMs: 2_000 });
 * stream.registerConsumer(new NotificationConsumer());
 * stream.registerConsumer(new AnalyticsConsumer());
 * stream.start();
 * // ... later
 * await stream.drain();
 * stream.stop();
 * ```
 */

import type { IEventBus, AnyDomainEvent, EventSubscription } from '../../services/shared/events';
import { eventBus as defaultEventBus } from '../../services/shared/events';
import type {
  BillingStreamConsumer,
  BillingStreamEvent,
  BillingStreamMetrics,
  BillingEventStreamConfig,
} from './types';

// ---------------------------------------------------------------------------
// BillingEventStream
// ---------------------------------------------------------------------------

export class BillingEventStream {
  private readonly consumers: BillingStreamConsumer[] = [];
  private readonly buffer: BillingStreamEvent[] = [];
  private busSubscription: EventSubscription | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  private _paused = false;
  private _received = 0;
  private _dispatched = 0;
  private _errors = 0;
  private _pauses = 0;

  constructor(
    config: BillingEventStreamConfig = {},
    private readonly bus: IEventBus = defaultEventBus,
  ) {
    this.batchSize = config.batchSize ?? 50;
    this.flushIntervalMs = config.flushIntervalMs ?? 5_000;
  }

  // ---------------------------------------------------------------------------
  // Consumer registration
  // ---------------------------------------------------------------------------

  /**
   * Register a consumer.  Must be called before `start()` or while paused.
   */
  registerConsumer(consumer: BillingStreamConsumer): this {
    this.consumers.push(consumer);
    return this;
  }

  /**
   * Remove a consumer by reference.
   */
  removeConsumer(consumer: BillingStreamConsumer): this {
    const idx = this.consumers.indexOf(consumer);
    if (idx !== -1) this.consumers.splice(idx, 1);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the stream processor.
   * Subscribes to all billing.* events on the bus and starts the flush timer.
   */
  start(): void {
    if (this.busSubscription) {
      // Already started — idempotent
      return;
    }

    // Subscribe to every event on the bus and filter for billing domain
    this.busSubscription = this.bus.subscribe(
      '*',
      (event: AnyDomainEvent) => {
        if (event.domain === 'billing') {
          this._onEvent(event as BillingStreamEvent);
        }
      },
    );

    // Periodic flush for non-full batches
    this.flushTimer = setInterval(() => {
      if (!this._paused && this.buffer.length > 0) {
        void this._flush();
      }
    }, this.flushIntervalMs);
  }

  /**
   * Stop the stream processor.
   * Does NOT flush remaining buffered events — call `drain()` first for graceful shutdown.
   */
  stop(): void {
    if (this.busSubscription) {
      this.busSubscription.unsubscribe();
      this.busSubscription = null;
    }
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Pause the stream.
   * New events arriving while paused are still buffered but not dispatched.
   * Notifies all consumers via their optional `onPause()` hook.
   */
  async pause(): Promise<void> {
    if (this._paused) return;
    this._paused = true;
    this._pauses++;
    await this._notifyConsumers('onPause');
  }

  /**
   * Resume the stream after a pause.
   * Triggers an immediate flush of any buffered events.
   * Notifies all consumers via their optional `onResume()` hook.
   */
  async resume(): Promise<void> {
    if (!this._paused) return;
    this._paused = false;
    await this._notifyConsumers('onResume');
    if (this.buffer.length > 0) {
      await this._flush();
    }
  }

  /**
   * Flush all remaining buffered events and wait for consumers to finish.
   * Call before `stop()` for a graceful shutdown.
   */
  async drain(): Promise<void> {
    while (this.buffer.length > 0) {
      await this._flush();
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  getMetrics(): BillingStreamMetrics {
    return {
      received: this._received,
      dispatched: this._dispatched,
      errors: this._errors,
      pauses: this._pauses,
      bufferDepth: this.buffer.length,
      paused: this._paused,
    };
  }

  resetMetrics(): void {
    this._received = 0;
    this._dispatched = 0;
    this._errors = 0;
    this._pauses = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _onEvent(event: BillingStreamEvent): void {
    this._received++;
    this.buffer.push(event);

    // Trigger an eager flush when the batch is full (even while paused we
    // keep buffering, but only flush when running)
    if (!this._paused && this.buffer.length >= this.batchSize) {
      void this._flush();
    }
  }

  private async _flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Drain up to batchSize events from the front of the buffer
    const batch = this.buffer.splice(0, this.batchSize);
    await this._dispatchBatch(batch);
  }

  private async _dispatchBatch(batch: BillingStreamEvent[]): Promise<void> {
    this._dispatched += batch.length;

    const tasks = this.consumers.map(async (consumer) => {
      try {
        await consumer.handleBatch(batch);
      } catch (err) {
        this._errors++;
        console.error(
          `[BillingEventStream] Consumer "${consumer.name}" failed on batch of ${batch.length}: ${String(err)}`,
        );
      }
    });

    await Promise.allSettled(tasks);
  }

  private async _notifyConsumers(hook: 'onPause' | 'onResume'): Promise<void> {
    const tasks = this.consumers.map(async (consumer) => {
      const fn = consumer[hook];
      if (typeof fn === 'function') {
        try {
          await fn.call(consumer);
        } catch (err) {
          console.error(
            `[BillingEventStream] Consumer "${consumer.name}" ${hook} hook failed: ${String(err)}`,
          );
        }
      }
    });
    await Promise.allSettled(tasks);
  }
}
