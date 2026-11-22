/**
 * Shared types for the Disaster Recovery (DR) system.
 *
 * These types are used across the DR library:
 *   - HealthCheckManager
 *   - DrStateManager
 *   - RunbookEngine
 *   - Individual runbooks
 */

// ---------------------------------------------------------------------------
// Health Check Types
// ---------------------------------------------------------------------------

export type HealthCheckCategory = 'build' | 'service' | 'database' | 'infrastructure';

export type HealthCheckStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface HealthCheckResult {
  /** Unique identifier for this check (e.g., "build:ci-pipeline") */
  id: string;
  /** Human-readable check name */
  name: string;
  /** Category of the check */
  category: HealthCheckCategory;
  /** Overall status */
  status: HealthCheckStatus;
  /** Pass/fail flag – critical/degraded = false */
  healthy: boolean;
  /** Optional message describing the status */
  message?: string;
  /** Metadata collected during the check */
  metadata?: Record<string, unknown>;
  /** Duration of the check in milliseconds */
  durationMs: number;
  /** Timestamp when the check completed */
  timestamp: number;
}

export interface HealthCheckSummary {
  /** All individual check results */
  checks: HealthCheckResult[];
  /** Overall aggregate status */
  overall: HealthCheckStatus;
  /** True only when every check is healthy */
  allHealthy: boolean;
  /** Timestamp of the summary */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// DR State Machine Types
// ---------------------------------------------------------------------------

export type DrStatePhase =
  | 'idle'
  | 'detecting'
  | 'recovering'
  | 'resolved'
  | 'failed'
  | 'manual-intervention';

export interface DrStateEntry {
  /** Current phase of the state machine */
  phase: DrStatePhase;
  /** Phase when we entered this state */
  enteredAt: number;
  /** What triggered the current state change */
  trigger?: string;
  /** Current runbook being executed (if any) */
  activeRunbook?: string;
  /** Execution attempt counter */
  attempt: number;
  /** Optional error message if phase is "failed" */
  errorMessage?: string;
  /** History of all previous phases (for audit) */
  history: DrStateTransition[];
}

export interface DrStateTransition {
  from: DrStatePhase;
  to: DrStatePhase;
  at: number;
  trigger?: string;
}

// ---------------------------------------------------------------------------
// Runbook Types
// ---------------------------------------------------------------------------

export type RunbookStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'rolled-back';

export interface RunbookStepResult {
  /** Step identifier */
  stepId: string;
  /** Step display name */
  name: string;
  /** Execution status */
  status: RunbookStepStatus;
  /** Duration in ms */
  durationMs: number;
  /** Optional human-readable detail */
  detail?: string;
  /** Error message if failed */
  error?: string;
  /** Number of attempts made */
  attempts: number;
  /** Output data produced by the step */
  output?: Record<string, unknown>;
}

export interface RunbookResult {
  /** Runbook identifier */
  runbookId: string;
  /** Runbook display name */
  name: string;
  /** True if all required steps succeeded */
  success: boolean;
  /** Individual step results */
  steps: RunbookStepResult[];
  /** Total wall-clock time in ms */
  totalDurationMs: number;
  /** Timestamp when execution started */
  startedAt: number;
  /** Timestamp when execution completed */
  completedAt: number;
  /** Optional error summary */
  error?: string;
  /** RTO compliance: was the runbook completed within the allowed recovery time? */
  rtoCompliant?: boolean;
  /** Recovery Time Objective in seconds used for this execution */
  rtoSeconds?: number;
}

export interface RunbookContext {
  /** Runbook instance ID */
  executionId: string;
  /** Optional build ID (for build-failure runbooks) */
  buildId?: string;
  /** Environment (e.g., "production", "staging", "ci") */
  environment: string;
  /** Triggering actor (human, automated system, CI) */
  triggeredBy: string;
  /** Additional free-form context passed to all steps */
  params: Record<string, unknown>;
  /** Shared state that steps may read/write */
  state: Record<string, unknown>;
  /** Start time of the runbook */
  startedAt: number;
  /** Logger function for step-level messages */
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export interface RunbookStepDefinition {
  /** Unique step ID within the runbook */
  id: string;
  /** Display name */
  name: string;
  /** Step implementation */
  execute: (ctx: RunbookContext) => Promise<{ success: boolean; detail?: string; output?: Record<string, unknown> }>;
  /** Optional rollback for this step */
  rollback?: (ctx: RunbookContext) => Promise<void>;
  /** Maximum retry attempts (default: 0 = no retry) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 500ms) */
  retryDelayMs?: number;
  /** Timeout for a single attempt in ms (default: 30_000ms) */
  timeoutMs?: number;
  /** If true, failure of this step does not stop the runbook */
  optional?: boolean;
  /** Step dependencies – list of step IDs that must succeed before this step */
  dependsOn?: string[];
}

export interface RunbookDefinition {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Recovery Time Objective in seconds */
  rtoSeconds: number;
  /** Ordered list of steps */
  steps: RunbookStepDefinition[];
  /** Called on runbook-level failure after all rollbacks */
  onFailure?: (ctx: RunbookContext, results: RunbookStepResult[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Build-specific Types
// ---------------------------------------------------------------------------

export type BuildFailureCategory =
  | 'compile-error'
  | 'test-failure'
  | 'dependency-error'
  | 'lint-error'
  | 'type-error'
  | 'deploy-failure'
  | 'contract-build-failure'
  | 'unknown';

export interface BuildFailureContext {
  buildId: string;
  branch: string;
  commit: string;
  failureCategory: BuildFailureCategory;
  errorLog?: string;
  buildTool?: string;
  environment?: string;
}

// ---------------------------------------------------------------------------
// Service Failover Types
// ---------------------------------------------------------------------------

export interface ServiceConfig {
  id: string;
  name: string;
  healthUrl?: string;
  primaryEndpoint: string;
  fallbackEndpoint?: string;
  criticalDependencies?: string[];
}

// ---------------------------------------------------------------------------
// Database Restore Types
// ---------------------------------------------------------------------------

export interface DatabaseRestoreConfig {
  databaseId: string;
  backupId?: string;
  backupPath?: string;
  targetEnvironment: string;
  verifyAfterRestore: boolean;
  pointInTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Rollback Types
// ---------------------------------------------------------------------------

export interface DeploymentInfo {
  deploymentId: string;
  version: string;
  previousVersion: string;
  environment: string;
  deployedAt: number;
  services?: string[];
}
