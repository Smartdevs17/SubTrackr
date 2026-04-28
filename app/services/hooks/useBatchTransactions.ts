// ════════════════════════════════════════════════════════════════
// REACT HOOK - Batch transaction management
// ════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import BatchTransactionService, { BatchExecutionResult } from '../batchTransactionService';

interface UseBatchTransactionsProps {
  maxBatchSize?: number;
}

/**
 * React hook for managing batch transactions
 */
export function useBatchTransactions({ maxBatchSize = 10 }: UseBatchTransactionsProps = {}) {
  const [service] = useState(() => new BatchTransactionService(maxBatchSize));

  const [pending, setPending] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<BatchExecutionResult | null>(null);

  /**
   * Add transaction to batch
   */
  const addTransaction = useCallback(
    (functionName: string, params: any[], required: boolean = true) => {
      const added = service.addTransaction(functionName, params, required);
      if (added) {
        setPending(service.getPendingCount());
      }
      return added;
    },
    [service]
  );

  /**
   * Add transaction with dependency
   */
  const addTransactionWithDependency = useCallback(
    (functionName: string, params: any[], dependsOn: number, required: boolean = true) => {
      const added = service.addTransactionWithDependency(functionName, params, dependsOn, required);
      if (added) {
        setPending(service.getPendingCount());
      }
      return added;
    },
    [service]
  );

  /**
   * Simulate batch
   */
  const simulateBatch = useCallback(async () => {
    const result = await service.simulateBatch();
    setLastResult(result);
    return result;
  }, [service]);

  /**
   * Execute batch
   */
  const executeBatch = useCallback(
    async (atomic: boolean = true) => {
      setExecuting(true);
      try {
        const result = await service.executeBatch(atomic);
        setLastResult(result);
        setPending(0);
        return result;
      } catch (error) {
        console.error('❌ Batch execution failed:', error);
        throw error;
      } finally {
        setExecuting(false);
      }
    },
    [service]
  );

  /**
   * Clear batch
   */
  const clearBatch = useCallback(() => {
    service.clearBatch();
    setPending(0);
  }, [service]);

  /**
   * Get gas estimate
   */
  const getGasEstimate = useCallback(() => {
    return service.getGasEstimate();
  }, [service]);

  /**
   * Get batch summary
   */
  const getBatchSummary = useCallback(() => {
    return service.getBatchSummary();
  }, [service]);

  /**
   * Get gas savings
   */
  const getGasSavings = useCallback(() => {
    return service.calculateGasSavings();
  }, [service]);

  return {
    // State
    pending,
    executing,
    lastResult,

    // Actions
    addTransaction,
    addTransactionWithDependency,
    simulateBatch,
    executeBatch,
    clearBatch,
    getGasEstimate,
    getBatchSummary,
    getGasSavings,

    // Helpers
    isBatchReady: () => service.isBatchReady(),
    isRunning: executing,
  };
}

export default useBatchTransactions;
