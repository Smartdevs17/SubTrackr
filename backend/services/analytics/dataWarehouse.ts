import { DataPipelineService } from './dataPipeline';

export interface SyncResult {
  merchantId: string;
  success: boolean;
  recordsProcessed: number;
  timestamp: string;
  errors?: string[];
}

export class DataWarehouseService {
  /**
   * Performs an incremental sync of data for a specific merchant to the configured data warehouse.
   */
  static async syncData(merchantId: string): Promise<SyncResult> {
    try {
      const status = await DataPipelineService.getPipelineStatus();
      if (!status.isActive) {
        throw new Error('Pipeline is not configured or active.');
      }

      // Simulate data extraction, transformation, and load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const recordsProcessed = Math.floor(Math.random() * 500) + 50; // Mock 50-550 records

      // Simulate data quality checks
      const qualityCheckPassed = Math.random() > 0.05; // 95% pass rate

      if (!qualityCheckPassed) {
        DataPipelineService.updateStatus(0, 'Data quality check failed');
        return {
          merchantId,
          success: false,
          recordsProcessed: 0,
          timestamp: new Date().toISOString(),
          errors: ['Data quality constraint violation: Null fields in mandatory columns.'],
        };
      }

      DataPipelineService.updateStatus(recordsProcessed);

      return {
        merchantId,
        success: true,
        recordsProcessed,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred during sync.';
      DataPipelineService.updateStatus(0, errorMessage);
      return {
        merchantId,
        success: false,
        recordsProcessed: 0,
        timestamp: new Date().toISOString(),
        errors: [errorMessage],
      };
    }
  }
}
