export interface PipelineConfig {
  warehouseType: 'BigQuery' | 'Snowflake';
  connectionString: string;
  syncIntervalHours: number;
  enableRealTimeStreaming: boolean;
}

export interface PipelineStatus {
  isActive: boolean;
  lastSyncTime: string | null;
  recordsSynced: number;
  error: string | null;
}

export class DataPipelineService {
  private static config: PipelineConfig | null = null;
  private static status: PipelineStatus = {
    isActive: false,
    lastSyncTime: null,
    recordsSynced: 0,
    error: null,
  };

  /**
   * Configures the data pipeline to connect to the selected data warehouse.
   */
  static async configurePipeline(config: PipelineConfig): Promise<boolean> {
    try {
      // Simulate connection test
      this.config = config;
      this.status.isActive = true;
      this.status.error = null;
      return true;
    } catch (error) {
      this.status.error = 'Failed to configure pipeline';
      return false;
    }
  }

  /**
   * Returns the current status of the data pipeline.
   */
  static async getPipelineStatus(): Promise<PipelineStatus> {
    return this.status;
  }

  /**
   * Internal helper to update status after sync operations
   */
  static updateStatus(records: number, error?: string) {
    if (error) {
      this.status.error = error;
    } else {
      this.status.recordsSynced += records;
      this.status.lastSyncTime = new Date().toISOString();
      this.status.error = null;
    }
  }
}
