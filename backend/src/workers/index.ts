/** Public API for the shared worker pool manager (Issue #2089). */

export {
  WorkerPoolError,
  WorkerPoolManager,
  closeWorkerPoolManager,
  getWorkerPoolManager,
} from './pool';
export type {
  WorkerHandle,
  WorkerPoolErrorCode,
  WorkerPoolLogger,
  WorkerPoolManagerConfig,
  WorkerPoolMetrics,
} from './pool';
