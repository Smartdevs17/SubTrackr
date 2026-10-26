import { useState, useCallback, useRef } from 'react';
import {
  BatchTransactionService,
  BatchExecutionResult,
  BatchCreateInput,
  BatchUpdateParams,
  UpdateFilter,
  CancelReason,
  PerItemResult,
  BatchProgress,
} from '../batchTransactionService';

interface UseBatchTransactionsProps {
  chunkSize?: number;
  rollbackHandler?: (result: BatchExecutionResult) => Promise<void>;
}

export function useBatchTransactions({ chunkSize = 50, rollbackHandler }: UseBatchTransactionsProps = {}) {
  const [service] = useState(() => new BatchTransactionService(chunkSize));
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BatchExecutionResult | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const rollbackHandlerRef = useRef(rollbackHandler);
  rollbackHandlerRef.current = rollbackHandler;

  const executeCreate = useCallback(
    async (
      inputs: BatchCreateInput[],
      addFn: (input: BatchCreateInput) => Promise<{ success: boolean; id?: string; error?: string }>,
      atomic?: boolean,
    ) => {
      setIsRunning(true);
      try {
        const result = await service.executeBatchCreate(inputs, addFn, { atomic });
        setLastResult(result);
        setProgress(service.getProgress());
        return result;
      } catch (error) {
        console.error('Batch create failed:', error);
        throw error;
      } finally {
        setIsRunning(false);
      }
    },
    [service],
  );

  const executeUpdate = useCallback(
    async (
      subscriptionIds: string[],
      updates: BatchUpdateParams,
      updateFn: (id: string, updates: BatchUpdateParams) => Promise<{ success: boolean; error?: string }>,
      options?: { atomic?: boolean; filter?: UpdateFilter },
    ) => {
      setIsRunning(true);
      try {
        const result = await service.executeBatchUpdate(subscriptionIds, updates, updateFn, options);
        setLastResult(result);
        setProgress(service.getProgress());
        return result;
      } catch (error) {
        console.error('Batch update failed:', error);
        throw error;
      } finally {
        setIsRunning(false);
      }
    },
    [service],
  );

  const executeCancel = useCallback(
    async (
      subscriptionIds: string[],
      cancelReasons: CancelReason[],
      cancelFn: (id: string, reason: CancelReason) => Promise<{ success: boolean; error?: string }>,
      atomic?: boolean,
    ) => {
      setIsRunning(true);
      try {
        const result = await service.executeBatchCancel(subscriptionIds, cancelReasons, cancelFn, { atomic });
        setLastResult(result);
        setProgress(service.getProgress());
        return result;
      } catch (error) {
        console.error('Batch cancel failed:', error);
        throw error;
      } finally {
        setIsRunning(false);
      }
    },
    [service],
  );

  const executeCharge = useCallback(
    async (
      chargeItems: Array<{ subscriptionId: string; amount: number }>,
      chargeFn: (id: string, amount: number) => Promise<{ success: boolean; error?: string }>,
      atomic?: boolean,
    ) => {
      setIsRunning(true);
      try {
        const result = await service.executeBatchCharge(chargeItems, chargeFn, { atomic });
        setLastResult(result);
        setProgress(service.getProgress());
        return result;
      } catch (error) {
        console.error('Batch charge failed:', error);
        throw error;
      } finally {
        setIsRunning(false);
      }
    },
    [service],
  );

  const retryFailed = useCallback(
    async (
      retryFn: (item: PerItemResult) => Promise<{ success: boolean; error?: string }>,
    ) => {
      setIsRunning(true);
      try {
        const result = await service.retryFailedItems(retryFn);
        setLastResult(result);
        setProgress(service.getProgress());
        return result;
      } catch (error) {
        console.error('Retry failed:', error);
        throw error;
      } finally {
        setIsRunning(false);
      }
    },
    [service],
  );

  const clearResult = useCallback(() => {
    service.clearResult();
    setLastResult(null);
    setProgress(null);
  }, [service]);

  const rollbackLast = useCallback(async () => {
    if (!lastResult) {
      console.warn('No batch result to rollback');
      return null;
    }
    const handler = rollbackHandlerRef.current;
    if (!handler) {
      console.warn('No rollbackHandler configured for useBatchTransactions');
      return lastResult;
    }
    try {
      await handler(lastResult);
      return lastResult;
    } catch (error) {
      console.error('Rollback failed:', error);
      throw error;
    }
  }, [lastResult]);

  return {
    isRunning,
    lastResult,
    progress,
    executeCreate,
    executeUpdate,
    executeCancel,
    executeCharge,
    retryFailed,
    rollbackLast,
    clearResult,
    getGasEstimate: (count: number) => service.getGasEstimate(count),
    setChunkSize: (size: number) => service.setChunkSize(size),
    getProgress: () => service.getProgress(),
  };
}

export default useBatchTransactions;