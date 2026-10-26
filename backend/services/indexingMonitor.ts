/**
 * IndexingMonitor — collects and exposes indexing lag, throughput,
 * reorg counts, and worker failure rates for the dashboard.
 *
 * Usage:
 *   const monitor = new IndexingMonitor(indexer);
 *   monitor.start();
 *   const snapshot = monitor.getSnapshot();  // call from dashboard API
 *   monitor.stop();
 */

import { BlockIndexer, IndexingStats } from './blockIndexer';

export interface MonitorSnapshot {
  timestamp: string;
  stats: IndexingStats;
  /** True when blocks/min is below 500 (target threshold). */
  belowTarget: boolean;
  /** True when lag exceeds 100 blocks (alert threshold). */
  lagAlert: boolean;
  /** True when worker failure rate > 5% of processed blocks. */
  highErrorRate: boolean;
  /** Rolling 5-minute history of stats snapshots. */
  history: IndexingStats[];
}

const TARGET_BLOCKS_PER_MINUTE = 500;
const LAG_ALERT_THRESHOLD = 100;
const MAX_HISTORY = 60; // 5 min at 5-second intervals

export class IndexingMonitor {
  private indexer: BlockIndexer;
  private history: IndexingStats[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;

  constructor(indexer: BlockIndexer, intervalMs = 5_000) {
    this.indexer = indexer;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): MonitorSnapshot {
    const stats = this.indexer.getStats();
    const failureRate =
      stats.processedBlocks > 0
        ? stats.workerFailures / stats.processedBlocks
        : 0;

    return {
      timestamp: new Date().toISOString(),
      stats,
      belowTarget: stats.isRunning && stats.blocksPerMinute < TARGET_BLOCKS_PER_MINUTE,
      lagAlert: stats.lagBlocks > LAG_ALERT_THRESHOLD,
      highErrorRate: failureRate > 0.05,
      history: [...this.history],
    };
  }

  private tick(): void {
    const stats = this.indexer.getStats();
    this.history.push({ ...stats });
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
  }
}
