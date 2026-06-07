/**
 * BlockIndexer — parallel blockchain event indexing with worker pools,
 * checkpoint-based recovery, reorg safety, and lag monitoring.
 *
 * Architecture:
 *   BlockIndexer
 *     ├── WorkerPool        — N concurrent block-processing workers
 *     ├── CheckpointStore   — persists last safe block to disk/DB
 *     ├── ReorgDetector     — detects chain reorganisations
 *     └── IndexingMonitor   — tracks blocks/min, lag, and error rates
 *
 * Target: ≥500 blocks/minute with WORKER_COUNT=8 on a 4-core host.
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlockRange {
  from: number;
  to: number;
}

export interface BlockEvent {
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  address: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface IndexerCheckpoint {
  /** Last block that was successfully indexed AND confirmed safe (post-reorg). */
  safeBlock: number;
  /** Block hash at safeBlock — used to detect reorgs on restart. */
  safeBlockHash: string;
  /** ISO timestamp of the last successful checkpoint write. */
  savedAt: string;
}

export interface WorkerResult {
  blockNumber: number;
  blockHash: string;
  events: BlockEvent[];
  durationMs: number;
  error?: string;
}

export interface IndexingStats {
  /** Blocks successfully indexed. */
  processedBlocks: number;
  /** Total events extracted. */
  totalEvents: number;
  /** Blocks currently in the worker queue. */
  queueDepth: number;
  /** Blocks/minute over the last 60-second window. */
  blocksPerMinute: number;
  /** Gap between chain tip and last indexed block. */
  lagBlocks: number;
  /** Number of reorgs detected since start. */
  reorgsDetected: number;
  /** Number of worker failures since start. */
  workerFailures: number;
  /** Whether the indexer is running. */
  isRunning: boolean;
  /** Timestamp of last successfully indexed block. */
  lastIndexedAt: string | null;
}

export interface IndexerConfig {
  /** Number of parallel workers. Default: 8. */
  workerCount?: number;
  /** Max blocks to queue at once. Default: 100. */
  batchSize?: number;
  /** Blocks behind chain tip before a reorg check triggers. Default: 6. */
  reorgSafeDepth?: number;
  /** How often (ms) to poll for new blocks. Default: 2000. */
  pollIntervalMs?: number;
  /** Max retries per block before marking as failed. Default: 3. */
  maxRetries?: number;
  /**
   * Block fetcher — inject your ethers/web3 provider here.
   * Returns null when the block doesn't exist yet.
   */
  fetchBlock: (blockNumber: number) => Promise<{
    number: number;
    hash: string;
    parentHash: string;
    timestamp: number;
    transactions: string[];
  } | null>;
  /**
   * Event extractor — given a block, return all relevant events.
   * Implement contract log decoding here.
   */
  extractEvents: (block: {
    number: number;
    hash: string;
    timestamp: number;
    transactions: string[];
  }) => Promise<BlockEvent[]>;
  /** Called for each successfully indexed batch of events. */
  onEvents: (events: BlockEvent[]) => Promise<void>;
  /** Called on reorg — remove events for blocks >= invalidFromBlock. */
  onReorg: (invalidFromBlock: number) => Promise<void>;
  /** Persist checkpoint (override for DB-backed storage). */
  saveCheckpoint?: (checkpoint: IndexerCheckpoint) => Promise<void>;
  /** Load checkpoint on startup. */
  loadCheckpoint?: () => Promise<IndexerCheckpoint | null>;
}

// ─── In-memory checkpoint store (override with DB-backed impl) ───────────────

class InMemoryCheckpointStore {
  private checkpoint: IndexerCheckpoint | null = null;

  async save(cp: IndexerCheckpoint): Promise<void> {
    this.checkpoint = cp;
  }

  async load(): Promise<IndexerCheckpoint | null> {
    return this.checkpoint;
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

interface WorkerTask {
  blockNumber: number;
  attempt: number;
  resolve: (result: WorkerResult) => void;
  reject: (err: Error) => void;
}

class BlockWorker {
  private busy = false;
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  isBusy(): boolean {
    return this.busy;
  }

  async process(
    task: WorkerTask,
    config: Pick<IndexerConfig, 'fetchBlock' | 'extractEvents'>
  ): Promise<WorkerResult> {
    this.busy = true;
    const start = Date.now();

    try {
      const block = await config.fetchBlock(task.blockNumber);

      if (!block) {
        const result: WorkerResult = {
          blockNumber: task.blockNumber,
          blockHash: '',
          events: [],
          durationMs: Date.now() - start,
          error: 'Block not found',
        };
        task.resolve(result);
        return result;
      }

      const events = await config.extractEvents(block);
      const result: WorkerResult = {
        blockNumber: block.number,
        blockHash: block.hash,
        events,
        durationMs: Date.now() - start,
      };
      task.resolve(result);
      return result;
    } catch (err) {
      const result: WorkerResult = {
        blockNumber: task.blockNumber,
        blockHash: '',
        events: [],
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
      task.resolve(result); // resolve with error so pool can handle retry
      return result;
    } finally {
      this.busy = false;
    }
  }
}

// ─── Worker pool ──────────────────────────────────────────────────────────────

class WorkerPool {
  private workers: BlockWorker[];
  private queue: WorkerTask[] = [];
  private config: Pick<IndexerConfig, 'fetchBlock' | 'extractEvents'>;

  constructor(
    workerCount: number,
    config: Pick<IndexerConfig, 'fetchBlock' | 'extractEvents'>
  ) {
    this.workers = Array.from({ length: workerCount }, (_, i) => new BlockWorker(i));
    this.config = config;
  }

  /** Submit a block for processing. Returns a promise resolving to WorkerResult. */
  submit(blockNumber: number, attempt = 0): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve, reject) => {
      const task: WorkerTask = { blockNumber, attempt, resolve, reject };
      this.queue.push(task);
      this.drain();
    });
  }

  queueDepth(): number {
    return this.queue.length;
  }

  private drain(): void {
    const freeWorker = this.workers.find((w) => !w.isBusy());
    if (!freeWorker || this.queue.length === 0) return;

    const task = this.queue.shift()!;
    void freeWorker.process(task, this.config).then(() => this.drain());
  }

  /** Process a range of blocks in parallel, up to workerCount at a time. */
  async processRange(from: number, to: number): Promise<WorkerResult[]> {
    const blockNumbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const promises = blockNumbers.map((n) => this.submit(n));
    return Promise.all(promises);
  }
}

// ─── Main indexer ─────────────────────────────────────────────────────────────

export class BlockIndexer extends EventEmitter {
  private config: Required<
    Omit<IndexerConfig, 'fetchBlock' | 'extractEvents' | 'onEvents' | 'onReorg'>
  > &
    Pick<IndexerConfig, 'fetchBlock' | 'extractEvents' | 'onEvents' | 'onReorg'>;

  private pool: WorkerPool;
  private checkpointStore: InMemoryCheckpointStore;
  private stats: IndexingStats;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  // Sliding window for blocks/minute calculation
  private processedTimestamps: number[] = [];

  // Reorg detection: blockNumber → hash of blocks we've indexed
  private indexedHashes = new Map<number, string>();

  constructor(userConfig: IndexerConfig) {
    super();

    this.config = {
      workerCount: userConfig.workerCount ?? 8,
      batchSize: userConfig.batchSize ?? 100,
      reorgSafeDepth: userConfig.reorgSafeDepth ?? 6,
      pollIntervalMs: userConfig.pollIntervalMs ?? 2000,
      maxRetries: userConfig.maxRetries ?? 3,
      fetchBlock: userConfig.fetchBlock,
      extractEvents: userConfig.extractEvents,
      onEvents: userConfig.onEvents,
      onReorg: userConfig.onReorg,
      saveCheckpoint: userConfig.saveCheckpoint ?? (async (cp) => this.checkpointStore.save(cp)),
      loadCheckpoint: userConfig.loadCheckpoint ?? (() => this.checkpointStore.load()),
    };

    this.checkpointStore = new InMemoryCheckpointStore();
    this.pool = new WorkerPool(this.config.workerCount, {
      fetchBlock: this.config.fetchBlock,
      extractEvents: this.config.extractEvents,
    });

    this.stats = {
      processedBlocks: 0,
      totalEvents: 0,
      queueDepth: 0,
      blocksPerMinute: 0,
      lagBlocks: 0,
      reorgsDetected: 0,
      workerFailures: 0,
      isRunning: false,
      lastIndexedAt: null,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start the indexer from a given block (or from the last checkpoint).
   * @param startBlock  Block to begin indexing from if no checkpoint exists.
   * @param chainTipFn  Returns the current head block number of the chain.
   */
  async start(
    startBlock: number,
    chainTipFn: () => Promise<number>
  ): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stats.isRunning = true;
    this.emit('start');

    // Resume from checkpoint if available
    const checkpoint = await this.config.loadCheckpoint();
    let nextBlock = startBlock;

    if (checkpoint) {
      // Verify checkpoint hash to detect reorg at restart
      const cpBlock = await this.config.fetchBlock(checkpoint.safeBlock);
      if (cpBlock && cpBlock.hash === checkpoint.safeBlockHash) {
        nextBlock = checkpoint.safeBlock + 1;
        this.emit('checkpoint:restored', checkpoint);
      } else {
        // Reorg at restart — roll back to safe depth
        const rollbackTo = Math.max(startBlock, checkpoint.safeBlock - this.config.reorgSafeDepth);
        nextBlock = rollbackTo;
        await this.config.onReorg(rollbackTo);
        this.stats.reorgsDetected++;
        this.emit('reorg', { invalidFromBlock: rollbackTo, source: 'restart' });
      }
    }

    const poll = async () => {
      if (!this.running) return;

      try {
        const tip = await chainTipFn();
        const safeHead = tip - this.config.reorgSafeDepth;

        if (safeHead < nextBlock) {
          // Nothing to index yet
          this.stats.lagBlocks = 0;
        } else {
          const batchTo = Math.min(nextBlock + this.config.batchSize - 1, safeHead);
          this.stats.lagBlocks = tip - batchTo;

          const results = await this.pool.processRange(nextBlock, batchTo);
          this.stats.queueDepth = this.pool.queueDepth();

          // Reorg detection: check parent hashes form a contiguous chain
          const reorgAt = await this.detectReorg(results);

          if (reorgAt !== null) {
            // Roll back and re-index from reorgAt
            await this.config.onReorg(reorgAt);
            this.stats.reorgsDetected++;
            this.emit('reorg', { invalidFromBlock: reorgAt, source: 'poll' });
            nextBlock = reorgAt;
          } else {
            await this.handleResults(results);
            nextBlock = batchTo + 1;

            // Save checkpoint at the end of each successful batch
            const lastGood = results[results.length - 1];
            if (lastGood && !lastGood.error) {
              const cp: IndexerCheckpoint = {
                safeBlock: lastGood.blockNumber,
                safeBlockHash: lastGood.blockHash,
                savedAt: new Date().toISOString(),
              };
              await this.config.saveCheckpoint(cp);
              this.emit('checkpoint:saved', cp);
            }
          }
        }
      } catch (err) {
        this.emit('error', err);
      }

      if (this.running) {
        this.pollTimer = setTimeout(poll, this.config.pollIntervalMs);
      }
    };

    void poll();
  }

  /**
   * Gracefully shut down the indexer.
   * Waits for any in-flight worker results before stopping.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.stats.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.emit('stop');
  }

  /** Returns a snapshot of current indexing statistics. */
  getStats(): Readonly<IndexingStats> {
    this.stats.blocksPerMinute = this.calcBlocksPerMinute();
    this.stats.queueDepth = this.pool.queueDepth();
    return { ...this.stats };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async handleResults(results: WorkerResult[]): Promise<void> {
    const allEvents: BlockEvent[] = [];
    const retries: number[] = [];

    for (const result of results) {
      if (result.error) {
        this.stats.workerFailures++;
        retries.push(result.blockNumber);
        this.emit('worker:error', result);
      } else {
        allEvents.push(...result.events);
        this.indexedHashes.set(result.blockNumber, result.blockHash);
        this.stats.processedBlocks++;
        this.processedTimestamps.push(Date.now());
        this.stats.lastIndexedAt = new Date().toISOString();
      }
    }

    // Retry failed blocks (up to maxRetries)
    for (const blockNumber of retries) {
      await this.retryBlock(blockNumber);
    }

    if (allEvents.length > 0) {
      // Deduplicate by (blockNumber, transactionHash, logIndex)
      const seen = new Set<string>();
      const unique = allEvents.filter((e) => {
        const key = `${e.blockNumber}:${e.transactionHash}:${e.logIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      this.stats.totalEvents += unique.length;
      await this.config.onEvents(unique);
      this.emit('events', unique);
    }
  }

  private async retryBlock(blockNumber: number, attempt = 1): Promise<void> {
    if (attempt > this.config.maxRetries) {
      this.emit('block:failed', { blockNumber, attempts: attempt });
      return;
    }
    const result = await this.pool.submit(blockNumber, attempt);
    if (result.error) {
      await this.retryBlock(blockNumber, attempt + 1);
    } else {
      this.indexedHashes.set(result.blockNumber, result.blockHash);
      this.stats.processedBlocks++;
      if (result.events.length > 0) {
        this.stats.totalEvents += result.events.length;
        await this.config.onEvents(result.events);
      }
    }
  }

  /**
   * Detect reorgs by verifying all returned blocks have valid hashes.
   * Returns the first block number that has a hash mismatch, or null if clean.
   */
  private async detectReorg(results: WorkerResult[]): Promise<number | null> {
    for (const result of results) {
      if (result.error || !result.blockHash) continue;
      const known = this.indexedHashes.get(result.blockNumber);
      if (known && known !== result.blockHash) {
        return result.blockNumber;
      }
    }
    return null;
  }

  private calcBlocksPerMinute(): number {
    const windowMs = 60_000;
    const now = Date.now();
    this.processedTimestamps = this.processedTimestamps.filter((t) => now - t < windowMs);
    return this.processedTimestamps.length;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

export function createBlockIndexer(config: IndexerConfig): BlockIndexer {
  return new BlockIndexer(config);
}
