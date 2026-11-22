export * from './interfaces';
export * from './inMemory';
export {
  PgSubscriptionRepository,
  PgTransactionRepository,
  PgUserRepository,
  PgMerchantRepository,
  PgLoyaltyRepository,
  PostgresUnitOfWork,
  createPostgresRepositories,
} from './postgres';
export type { PgTransactionContext } from './postgres';
// ── Data mapper and repository factory (Issue #2215) ──────────────────────────
export {
  SubscriptionDataMapper,
  TransactionDataMapper,
  UserDataMapper,
  MerchantDataMapper,
  LoyaltyDataMapper,
  DataMapperRegistry,
  dataMapperRegistry,
} from './dataMapper';
export type {
  IDataMapper,
  SubscriptionRow,
  TransactionRow,
  UserRow,
  MerchantRow,
  LoyaltyRow,
} from './dataMapper';
export {
  createRepositorySet,
  initRepositoryFactory,
  getRepositorySet,
  resetRepositoryFactory,
} from './repositoryFactory';
export type {
  StorageBackend,
  RepositorySet,
  RepositoryFactoryOptions,
} from './repositoryFactory';
