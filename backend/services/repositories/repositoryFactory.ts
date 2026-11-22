/**
 * Repository factory — creates repository sets by storage backend.
 *
 * Issue #2215: Implement repository abstraction layer for database isolation.
 *
 * The factory provides a single entry point for obtaining repositories and
 * unit-of-work instances. Callers specify a backend type ('in-memory' or
 * 'postgres') and receive a fully wired set of repositories. This isolates
 * the rest of the application from the storage choice, which is important
 * for testing (use in-memory) and for future migration to other backends.
 */

import type {
  ISubscriptionRepository,
  ITransactionRepository,
  IUserRepository,
  IMerchantRepository,
  ILoyaltyRepository,
  IUnitOfWork,
} from './interfaces';
import {
  InMemorySubscriptionRepository,
  InMemoryTransactionRepository,
  InMemoryUserRepository,
  InMemoryMerchantRepository,
  InMemoryLoyaltyRepository,
  InMemoryUnitOfWork,
} from './inMemory';
import type { Pool } from '../../shared/db/connectionPool';

export type StorageBackend = 'in-memory' | 'postgres';

export interface RepositorySet {
  subscriptions: ISubscriptionRepository;
  transactions: ITransactionRepository;
  users: IUserRepository;
  merchants: IMerchantRepository;
  loyalty: ILoyaltyRepository;
  unitOfWork: IUnitOfWork;
  backend: StorageBackend;
}

export interface RepositoryFactoryOptions {
  backend?: StorageBackend;
  /** Required when backend is 'postgres'. */
  pool?: Pool;
}

/**
 * Create a set of repositories for the specified backend.
 *
 * For 'postgres', pass a `Pool` instance. For 'in-memory', no pool is
 * needed — the factory returns fresh in-memory repositories.
 */
export function createRepositorySet(options: RepositoryFactoryOptions = {}): RepositorySet {
  const backend = options.backend ?? 'in-memory';

  if (backend === 'in-memory') {
    const unitOfWork = new InMemoryUnitOfWork();
    return {
      subscriptions: unitOfWork.subscriptions,
      transactions: unitOfWork.transactions,
      users: unitOfWork.users,
      merchants: unitOfWork.merchants,
      loyalty: unitOfWork.loyalty,
      unitOfWork,
      backend,
    };
  }

  if (backend === 'postgres') {
    if (!options.pool) {
      throw new Error('A Pool instance is required when backend is "postgres"');
    }
    // Lazy-load to avoid importing pg types in test environments.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPostgresRepositories } = require('./postgres');
    const pgSet = createPostgresRepositories(options.pool);
    return {
      subscriptions: pgSet.subscriptions,
      transactions: pgSet.transactions,
      users: pgSet.users,
      merchants: pgSet.merchants,
      loyalty: pgSet.loyalty,
      unitOfWork: pgSet.unitOfWork,
      backend,
    };
  }

  throw new Error(`Unknown storage backend: "${backend}"`);
}

/**
 * Singleton factory — holds one RepositorySet for the process lifetime.
 *
 * The backend is determined by the `REPOSITORY_BACKEND` environment variable
 * (default: 'in-memory'). Call `initRepositoryFactory` at startup with the
 * desired pool if using Postgres.
 */
let currentSet: RepositorySet | null = null;

export function initRepositoryFactory(options: RepositoryFactoryOptions): RepositorySet {
  currentSet = createRepositorySet(options);
  return currentSet;
}

export function getRepositorySet(): RepositorySet {
  if (!currentSet) {
    // Default to in-memory for safety.
    currentSet = createRepositorySet({ backend: 'in-memory' });
  }
  return currentSet;
}

export function resetRepositoryFactory(): void {
  currentSet = null;
}
