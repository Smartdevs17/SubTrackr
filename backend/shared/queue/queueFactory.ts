/**
 * Factory for wiring a complete weighted-fair job queue system.
 */

import type { ConnectionOptions } from 'bullmq';
import { PriorityQueue } from './priorityQueue';
import { WeightedFairQueue, type WeightedFairQueueConfig } from './weightedFairQueue';
import type { PriorityClass } from './types';

export interface JobQueueSystemConfig {
  connection: ConnectionOptions;
  baseQueueName?: string;
  maxQueueSize?: number;
  weights?: WeightedFairQueueConfig['weights'];
}

export interface JobQueueSystem {
  scheduler: WeightedFairQueue;
  queues: Record<PriorityClass, PriorityQueue>;
}

export function createJobQueueSystem(config: JobQueueSystemConfig): JobQueueSystem {
  const baseQueueName = config.baseQueueName ?? 'subtrackr:jobs';
  const maxSize = config.maxQueueSize ?? 10_000;

  const queues = {
    critical: new PriorityQueue({ connection: config.connection, baseQueueName, priority: 'critical', maxSize }),
    high: new PriorityQueue({ connection: config.connection, baseQueueName, priority: 'high', maxSize }),
    normal: new PriorityQueue({ connection: config.connection, baseQueueName, priority: 'normal', maxSize }),
    low: new PriorityQueue({ connection: config.connection, baseQueueName, priority: 'low', maxSize }),
  };

  const scheduler = new WeightedFairQueue(queues, {
    weights: config.weights,
    maxQueueSize: maxSize,
  });

  return { scheduler, queues };
}
