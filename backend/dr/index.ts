/**
 * Disaster Recovery module index.
 * Re-exports all public DR types and classes.
 */

// Types
export * from './types';

// Core modules
export { HealthCheckManager, healthCheckManager } from './HealthCheckManager';
export { DrStateManager, drStateManager } from './DrStateManager';
export { RunbookEngine, runbookEngine } from './RunbookEngine';

// Runbooks
export { createBuildFailureRunbook, detectFailureCategory } from './runbooks/BuildFailureRunbook';
export { createDatabaseRestoreRunbook } from './runbooks/DatabaseRestoreRunbook';
export { createServiceFailoverRunbook } from './runbooks/ServiceFailoverRunbook';
export { createRollbackRunbook } from './runbooks/RollbackRunbook';

// Legacy DR service (mobile-focused, AsyncStorage-based)
export { DisasterRecoveryService, disasterRecoveryService, RTO_SECONDS, RPO_SECONDS } from './DisasterRecoveryService';
export { DisasterRecoveryMonitor, drMonitor } from './drMonitoring';
