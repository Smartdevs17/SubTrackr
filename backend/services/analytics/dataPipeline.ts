import { BlockIndexer, createBlockIndexer, IndexerConfig, IndexingStats } from './blockIndexer';
import { IndexingMonitor, MonitorSnapshot } from './indexingMonitor';

export interface PipelineConfig {
  warehouseType: 'BigQuery' | 'Snowflake';
  connectionString: string;
  syncIntervalHours: number;
  enableRealTimeStreaming: boolean;
  /** Optional blockchain indexer config. When provided, parallel block
   *  indexing is started alongside the warehouse sync pipeline. */
  indexer?: IndexerConfig & {
    startBlock: number;
    getChainTip: () => Promise<number>;
  };
}

export interface PipelineStatus {
  isActive: boolean;
  lastSyncTime: string | null;
  recordsSynced: number;
  error: string | null;
  /** Present when the indexer is running. */
  indexing?: IndexingStats;
}

export class DataPipelineService {
  private static config: PipelineConfig | null = null;
  private static status: PipelineStatus = {
    isActive: false,
    lastSyncTime: null,
    recordsSynced: 0,
    error: null,
  };

  private static indexer: BlockIndexer | null = null;
  private static monitor: IndexingMonitor | null = null;

  /**
   * Configures the data pipeline. If `config.indexer` is supplied, spins up
   * the parallel block indexer and its monitoring dashboard.
   */
  static async configurePipeline(config: PipelineConfig): Promise<boolean> {
    try {
      this.config = config;
      this.status.isActive = true;
      this.status.error = null;

      if (config.indexer) {
        const { startBlock, getChainTip, ...indexerConfig } = config.indexer;
        this.indexer = createBlockIndexer(indexerConfig);
        this.monitor = new IndexingMonitor(this.indexer);
        this.monitor.start();
        await this.indexer.start(startBlock, getChainTip);
      }

      return true;
    } catch (error) {
      this.status.error = 'Failed to configure pipeline';
      return false;
    }
  }

  /** Returns the current status including live indexing stats when available. */
  static async getPipelineStatus(): Promise<PipelineStatus> {
    return {
      ...this.status,
      ...(this.indexer ? { indexing: this.indexer.getStats() } : {}),
    };
  }

  /** Returns the indexing monitor dashboard snapshot. */
  static getMonitorSnapshot(): MonitorSnapshot | null {
    return this.monitor ? this.monitor.getSnapshot() : null;
  }

  /** Gracefully stops the block indexer and monitor. */
  static async shutdown(): Promise<void> {
    this.monitor?.stop();
    await this.indexer?.stop();
    this.status.isActive = false;
  }

  static updateStatus(records: number, error?: string): void {
    if (error) {
      this.status.error = error;
    } else {
      this.status.recordsSynced += records;
      this.status.lastSyncTime = new Date().toISOString();
      this.status.error = null;
    }
  }
}
