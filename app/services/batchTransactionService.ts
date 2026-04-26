// ════════════════════════════════════════════════════════════════
// BATCH TRANSACTION SERVICE - Frontend batch management
// ════════════════════════════════════════════════════════════════

/**
 * Represents a single transaction in a batch
 */
export interface BatchTransaction {
  functionName: string;
  params: any[];
  dependsOn?: number;
  required: boolean;
}

/**
 * Result of executing a batch operation
 */
export interface OperationResult {
  index: number;
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Complete batch result
 */
export interface BatchExecutionResult {
  batchId: string;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  results: OperationResult[];
  atomic: boolean;
  gasEstimate: number;
}

/**
 * Batch Transaction Service - Handles transaction batching
 */
export class BatchTransactionService {
  private pendingTransactions: BatchTransaction[] = [];
  private maxBatchSize: number = 10;
  private gasPerOperation: number = 100_000;
  private baseGasCost: number = 50_000;

  constructor(maxBatchSize: number = 10) {
    this.maxBatchSize = maxBatchSize;
  }

  /**
   * Add transaction to batch queue
   * @returns true if added, false if batch is full
   */
  addTransaction(functionName: string, params: any[], required: boolean = true): boolean {
    // Check if batch is full
    if (this.pendingTransactions.length >= this.maxBatchSize) {
      console.warn(`Batch is full (${this.maxBatchSize}), cannot add more transactions`);
      return false;
    }

    const transaction: BatchTransaction = {
      functionName,
      params,
      required,
    };

    this.pendingTransactions.push(transaction);
    console.log(
      `✅ Added ${functionName}. Pending: ${this.pendingTransactions.length}/${this.maxBatchSize}`
    );

    return true;
  }

  /**
   * Add transaction with dependency on another operation
   */
  addTransactionWithDependency(
    functionName: string,
    params: any[],
    dependsOn: number,
    required: boolean = true
  ): boolean {
    if (this.pendingTransactions.length >= this.maxBatchSize) {
      return false;
    }

    // Validate dependency
    if (dependsOn >= this.pendingTransactions.length) {
      console.error(`Invalid dependency: index ${dependsOn} out of range`);
      return false;
    }

    const transaction: BatchTransaction = {
      functionName,
      params,
      dependsOn,
      required,
    };

    this.pendingTransactions.push(transaction);
    return true;
  }

  /**
   * Get pending transactions count
   */
  getPendingCount(): number {
    return this.pendingTransactions.length;
  }

  /**
   * Is batch ready to execute?
   */
  isBatchReady(): boolean {
    return this.pendingTransactions.length >= this.maxBatchSize;
  }

  /**
   * Get current pending batch
   */
  getPendingBatch(): BatchTransaction[] {
    return [...this.pendingTransactions];
  }

  /**
   * Simulate batch execution without actually executing
   * Useful for gas estimation and validation
   */
  async simulateBatch(): Promise<BatchExecutionResult> {
    console.log(`📊 Simulating batch with ${this.pendingTransactions.length} operations...`);

    const totalGas = this.getGasEstimate();
    const batchId = this.generateBatchId();

    const results: OperationResult[] = this.pendingTransactions.map((tx, index) => ({
      index,
      success: true,
      result: null,
    }));

    return {
      batchId,
      totalOperations: this.pendingTransactions.length,
      successfulOperations: this.pendingTransactions.length,
      failedOperations: 0,
      results,
      atomic: false,
      gasEstimate: totalGas,
    };
  }

  /**
   * Execute batch synchronously
   */
  async executeBatch(atomic: boolean = true): Promise<BatchExecutionResult> {
    console.log(
      `🚀 Executing batch with ${this.pendingTransactions.length} operations (atomic: ${atomic})...`
    );

    if (this.pendingTransactions.length === 0) {
      throw new Error('❌ No transactions to execute');
    }

    const results: OperationResult[] = [];
    let successCount = 0;
    let failCount = 0;
    let totalGas = 0;
    let shouldStop = false;

    // Execute each transaction
    for (let i = 0; i < this.pendingTransactions.length; i++) {
      const tx = this.pendingTransactions[i];

      // Check if we should stop (atomic mode)
      if (shouldStop && atomic) {
        results.push({
          index: i,
          success: false,
          error: 'Skipped due to atomic failure',
        });
        failCount++;
        continue;
      }

      // Check dependencies
      if (tx.dependsOn !== undefined) {
        const dependencyResult = results[tx.dependsOn];
        if (!dependencyResult.success) {
          results.push({
            index: i,
            success: false,
            error: 'Dependency failed',
          });
          failCount++;

          if (tx.required) {
            shouldStop = true;
          }
          continue;
        }
      }

      // Execute transaction
      try {
        console.log(`  📝 Executing: ${tx.functionName}`);

        // Simulate execution
        const result = await this.executeTransaction(tx);
        const gasUsed = this.gasPerOperation;

        results.push({
          index: i,
          success: true,
          result,
        });

        successCount++;
        totalGas += gasUsed;
      } catch (error) {
        console.error(`  ❌ Transaction failed: ${tx.functionName}`, error);

        results.push({
          index: i,
          success: false,
          error: String(error),
        });

        failCount++;

        if (tx.required) {
          shouldStop = true;
        }
      }
    }

    const batchResult: BatchExecutionResult = {
      batchId: this.generateBatchId(),
      totalOperations: this.pendingTransactions.length,
      successfulOperations: successCount,
      failedOperations: failCount,
      results,
      atomic,
      gasEstimate: totalGas,
    };

    // Clear batch after execution
    this.pendingTransactions = [];

    console.log(`✅ Batch complete: ${successCount}/${batchResult.totalOperations} successful`);
    console.log(`   Gas used: ${totalGas.toLocaleString()} units`);

    return batchResult;
  }

  /**
   * Execute single transaction (simulated)
   */
  private async executeTransaction(_tx: BatchTransaction): Promise<any> {
    // In real implementation, call actual contract function
    // For now, simulate with delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, txHash: `0x${Math.random().toString(16).slice(2)}` });
      }, 100);
    });
  }

  /**
   * Clear pending batch
   */
  clearBatch(): void {
    this.pendingTransactions = [];
    console.log('🗑️ Batch cleared');
  }

  /**
   * Get gas estimate for pending batch
   */
  getGasEstimate(): number {
    return this.baseGasCost + this.pendingTransactions.length * this.gasPerOperation;
  }

  /**
   * Get batch summary
   */
  getBatchSummary(): {
    pending: number;
    maxSize: number;
    estimatedGas: number;
    isFull: boolean;
    gasPercentFull: number;
  } {
    const pending = this.pendingTransactions.length;
    const percentFull = (pending / this.maxBatchSize) * 100;

    return {
      pending,
      maxSize: this.maxBatchSize,
      estimatedGas: this.getGasEstimate(),
      isFull: this.isBatchReady(),
      gasPercentFull: percentFull,
    };
  }

  /**
   * Set maximum batch size
   */
  setMaxBatchSize(size: number): void {
    if (size > 100) {
      console.warn('Max batch size should not exceed 100');
      return;
    }
    this.maxBatchSize = size;
    console.log(`📦 Max batch size set to: ${size}`);
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `batch_${timestamp}_${random}`;
  }

  /**
   * Calculate gas savings
   */
  calculateGasSavings(): {
    individual: number;
    batched: number;
    savings: number;
    percentSavings: number;
  } {
    const numTx = this.pendingTransactions.length;
    const individualGas = numTx * (this.baseGasCost + this.gasPerOperation);
    const batchedGas = this.getGasEstimate();
    const savings = individualGas - batchedGas;
    const percentSavings = (savings / individualGas) * 100;

    return {
      individual: individualGas,
      batched: batchedGas,
      savings,
      percentSavings,
    };
  }
}

// Export for use in React components
export default BatchTransactionService;
