# Build Disaster Recovery Runbooks

## Overview

This document covers the **build-level disaster recovery** system for SubTrackr — a set of automated runbooks, health checks, and state management tools that detect, respond to, and recover from CI/CD build failures, deployment failures, and service outages.

For the **mobile app / AsyncStorage-level** DR (backup and restore of wallet/subscription data), see [DISASTER_RECOVERY_RUNBOOK.md](../DISASTER_RECOVERY_RUNBOOK.md).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DR Automation System                            │
│                                                                     │
│  ┌───────────────────┐    ┌──────────────────┐    ┌─────────────┐  │
│  │  HealthCheckMgr   │───▶│  DrStateManager  │───▶│  Runbook    │  │
│  │  - build env      │    │  idle            │    │  Engine     │  │
│  │  - dependencies   │    │  detecting       │    │  - retry    │  │
│  │  - tsconfig       │    │  recovering      │    │  - rollback │  │
│  │  - package.json   │    │  resolved        │    │  - timeout  │  │
│  │  - disk/memory    │    │  failed          │    │  - deps     │  │
│  └───────────────────┘    └──────────────────┘    └──────┬──────┘  │
│                                                          │          │
│              ┌───────────────────────────────────────────┤          │
│              ▼           ▼                ▼              ▼          │
│  ┌─────────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐   │
│  │ BuildFailure    │ │ Database │ │  Service   │ │  Rollback  │   │
│  │ Runbook         │ │ Restore  │ │  Failover  │ │  Runbook   │   │
│  │ (RTO: 10 min)   │ │ Runbook  │ │  Runbook   │ │ (RTO:10min)│   │
│  │                 │ │(RTO:15m) │ │ (RTO: 5m)  │ │            │   │
│  └─────────────────┘ └──────────┘ └────────────┘ └────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### File Layout

```
backend/dr/
├── types.ts                          # Shared DR types
├── HealthCheckManager.ts             # Build/infra health checks
├── DrStateManager.ts                 # DR state machine
├── RunbookEngine.ts                  # Step executor with retry/rollback
├── DisasterRecoveryService.ts        # Mobile-app DR (AsyncStorage)
├── drMonitoring.ts                   # DR health monitor daemon
├── index.ts                          # Public re-exports
└── runbooks/
    ├── BuildFailureRunbook.ts        # CI/CD build failure recovery
    ├── DatabaseRestoreRunbook.ts     # DB restore from backup
    ├── ServiceFailoverRunbook.ts     # Service failover
    └── RollbackRunbook.ts            # Deployment rollback

scripts/
├── dr-recover.sh                     # Trigger any DR scenario
├── dr-status.sh                      # Show DR health status
└── dr-backup.sh                      # Create a DR backup

backend/dr/__tests__/
├── HealthCheckManager.test.ts
├── DrStateManager.test.ts
├── RunbookEngine.test.ts
├── dr-integration.test.ts
└── runbooks/
    ├── BuildFailureRunbook.test.ts
    ├── DatabaseRestoreRunbook.test.ts
    ├── ServiceFailoverRunbook.test.ts
    └── RollbackRunbook.test.ts
```

---

## Recovery Time Objectives (RTO)

| Runbook              | RTO     | Use Case                                     |
|----------------------|---------|----------------------------------------------|
| Build Failure        | 10 min  | CI/CD pipeline failure, lint/type/dep errors  |
| Database Restore     | 15 min  | DB corruption, snapshot restore               |
| Service Failover     | 5 min   | Primary service outage, fallback routing      |
| Rollback             | 10 min  | Bad deployment, contract rollback             |

---

## Quick Start

### Check DR Health

```bash
# Human-readable status
./scripts/dr-status.sh

# JSON output (for CI/monitoring)
./scripts/dr-status.sh --json

# Run active health checks
./scripts/dr-status.sh --checks

# Short mode (exit code reflects health)
./scripts/dr-status.sh --short
```

### Trigger a Recovery

```bash
# Build failure recovery
./scripts/dr-recover.sh build-failure \
  --build-id ci-run-1234 \
  --branch main \
  --env production

# Database restore
./scripts/dr-recover.sh db-restore \
  --env production

# Service failover
SERVICE_ID=api \
PRIMARY_ENDPOINT=http://api.prod:3000 \
FALLBACK_ENDPOINT=http://api-backup.prod:3000 \
./scripts/dr-recover.sh service-failover

# Deployment rollback
CURRENT_VERSION=2.1.0 \
PREVIOUS_VERSION=2.0.0 \
./scripts/dr-recover.sh rollback --env production

# Full DR drill (backup → verify → restore)
./scripts/dr-recover.sh full-dr

# Dry run (simulate without changes)
./scripts/dr-recover.sh build-failure --dry-run
```

### Create a Backup

```bash
./scripts/dr-backup.sh
./scripts/dr-backup.sh --region eu-west-1 --pre-check
./scripts/dr-backup.sh --dry-run
```

---

## Programmatic Usage

### Running a Runbook from TypeScript

```typescript
import {
  createBuildFailureRunbook,
  RunbookEngine,
  DrStateManager,
} from './backend/dr';

const engine = new RunbookEngine();
const stateManager = new DrStateManager();

// Transition to detecting
stateManager.transition('detecting', { trigger: 'ci-failure' });

// Create and execute runbook
const runbook = createBuildFailureRunbook({
  buildId: 'ci-run-001',
  branch: 'main',
  commit: 'abc1234',
  failureCategory: 'dependency-error',
  environment: 'production',
});

const result = await engine.execute(runbook, {
  environment: 'production',
  triggeredBy: 'ci-watchdog',
});

// Update state based on result
stateManager.transition(result.success ? 'resolved' : 'failed');

console.log(`Runbook ${result.success ? 'succeeded' : 'failed'} in ${result.totalDurationMs}ms`);
console.log(`RTO compliant: ${result.rtoCompliant}`);
```

### Health Checks

```typescript
import { HealthCheckManager } from './backend/dr';

const mgr = new HealthCheckManager({ projectRoot: process.cwd() });
const summary = await mgr.runAll();

if (!summary.allHealthy) {
  console.error('Health checks failed:', summary.overall);
  for (const check of summary.checks.filter(c => !c.healthy)) {
    console.error(`  ${check.name}: ${check.message}`);
  }
}

// Run only build checks
const buildSummary = await mgr.runCategory('build');

// Check a single item
const nodeCheck = await mgr.runById('build:node-version');
```

### State Machine

```typescript
import { DrStateManager } from './backend/dr';

const sm = new DrStateManager();

// Subscribe to changes
const unsubscribe = sm.onStateChange((state) => {
  console.log(`DR state: ${state.phase} (attempt: ${state.attempt})`);
});

sm.transition('detecting', { trigger: 'alert-fired' });
sm.transition('recovering', { activeRunbook: 'build-failure' });

// ... run runbook ...

sm.transition('resolved');
sm.transition('idle' as any); // Reset

// Clean up listener
unsubscribe();
```

---

## Runbooks

### Build Failure Runbook

**ID:** `build-failure`  
**RTO:** 600s (10 minutes)

Handles CI/CD build failures categorised as:

| Category              | Recovery Action                            |
|-----------------------|---------------------------------------------|
| `dependency-error`    | `npm install --prefer-offline`, retry       |
| `lint-error`          | `npm run lint:fix`, retry build             |
| `type-error`          | `tsc --skipLibCheck`, retry with bypass     |
| `test-failure`        | Cache clear, retry build                    |
| `contract-build-failure` | `npm run contracts:build`, retry         |
| `compile-error`       | Cache clear, retry build                    |
| `unknown`             | Auto-detect from error log, retry           |

Steps: `diagnose → clear-cache → reinstall-deps → fix-lint → retry-build → notify`

### Database Restore Runbook

**ID:** `database-restore`  
**RTO:** 900s (15 minutes)

Restores a database from a backup with pre-restore safety snapshot.

Steps: `validate-config → pre-restore-snapshot → restore-database → verify-restore → warm-connections`

Config:

```typescript
const runbook = createDatabaseRestoreRunbook({
  databaseId: 'subtrackr-primary',
  backupId: 'backup-20240826',   // OR backupPath for local file
  targetEnvironment: 'production',
  verifyAfterRestore: true,
  pointInTimeMs: Date.now() - 3600_000, // Optional PITR
});
```

### Service Failover Runbook

**ID:** `service-failover`  
**RTO:** 300s (5 minutes)

Checks primary health, verifies fallback, updates routing.

Steps: `check-primary → verify-fallback → initiate-failover → drain-primary → smoke-test`

The `drain-primary` step inserts a 5s grace period for in-flight requests.

### Rollback Runbook

**ID:** `rollback`  
**RTO:** 600s (10 minutes)

Rolls back a deployment, handling three scenarios:
- **Contract rollback**: Calls the Soroban proxy scheduled-rollback mechanism
- **Git tag rollback**: `git checkout v{version}`
- **CI trigger rollback**: Records intent for CI/CD pipeline

Steps: `validate-rollback-target → notify-rollback-start → execute-rollback → verify-post-rollback → archive-artefacts`

---

## RunbookEngine Features

### Retry with Exponential Backoff

```typescript
{
  id: 'my-step',
  maxRetries: 3,
  retryDelayMs: 1_000,     // 1s, 2s, 4s between retries
  execute: async (ctx) => { ... }
}
```

### Per-Step Timeout

```typescript
{
  id: 'slow-step',
  timeoutMs: 30_000,        // Fails if not completed in 30s
  execute: async (ctx) => { ... }
}
```

### Step Rollback

```typescript
{
  id: 'infra-change',
  execute: async (ctx) => {
    ctx.state['prevConfig'] = await readConfig();
    await applyConfig(newConfig);
    return { success: true };
  },
  rollback: async (ctx) => {
    await applyConfig(ctx.state['prevConfig']);
  }
}
```

Rollbacks fire in **reverse order** of step completion when a required step fails.

### Dependency Ordering

```typescript
steps: [
  { id: 'restore', execute: doRestore },
  { id: 'verify', dependsOn: ['restore'], execute: doVerify },
  { id: 'warm', dependsOn: ['verify'], optional: true, execute: doWarm },
]
```

---

## DR State Machine

States and valid transitions:

```
idle ──────────────────────────────────────────────────────────────────▶ detecting
         ▲                                                                  │
         │                                                     ┌────────────┤
         │                                                     ▼            │
      resolved ◀─────────────── recovering ◀──────────────────┘            │
                                     │                                      │
                                     └──────────────▶ failed ──────────────┘
                                                          │
                                                          └──▶ detecting (retry)

         Any state ──▶ manual-intervention ──▶ idle | detecting | recovering
```

---

## npm Scripts

```bash
# Run DR health checks
npm run dr:check

# Run the full DR test drill
npm run dr:test

# Run DR tests with coverage
npm run dr:test:coverage

# Trigger build failure recovery
npm run dr:recover build-failure

# Check DR status
npm run dr:status
```

---

## CI Integration

Add to your GitHub Actions workflow:

```yaml
- name: DR Health Check
  run: ./scripts/dr-status.sh --short

- name: DR Test Drill
  run: npm run dr:test

- name: Build Failure Recovery (on failure)
  if: failure()
  run: |
    ./scripts/dr-recover.sh build-failure \
      --build-id ${{ github.run_id }} \
      --branch ${{ github.ref_name }} \
      --env ci
```

---

## Extending the DR System

### Adding a Custom Health Check

```typescript
import { HealthCheckManager } from './backend/dr';

const mgr = new HealthCheckManager({
  customChecks: [
    async () => ({
      id: 'my:custom-check',
      name: 'My custom check',
      category: 'service' as const,
      status: 'healthy' as const,
      healthy: true,
      message: 'All good',
    }),
  ],
});
```

### Adding a Custom Runbook

```typescript
import { RunbookDefinition } from './backend/dr/types';

const myRunbook: RunbookDefinition = {
  id: 'my-runbook',
  name: 'My Custom Runbook',
  description: 'Custom recovery procedure',
  rtoSeconds: 300,
  steps: [
    {
      id: 'step-1',
      name: 'Do something',
      maxRetries: 2,
      execute: async (ctx) => {
        ctx.log('info', 'Doing something...');
        // your recovery logic
        return { success: true, detail: 'Done' };
      },
    },
  ],
};
```

---

## Metrics

Every runbook execution produces a `RunbookResult`:

| Field              | Description                                             |
|--------------------|---------------------------------------------------------|
| `success`          | Whether all required steps succeeded                     |
| `totalDurationMs`  | Wall-clock time of the entire runbook                    |
| `rtoCompliant`     | Whether execution completed within the defined RTO       |
| `rtoSeconds`       | The RTO target                                           |
| `steps[].attempts` | Number of retry attempts for each step                   |
| `steps[].status`   | `succeeded` | `failed` | `skipped` | `rolled-back`      |

The DR recovery log is persisted to `.dr-recovery-log.jsonl` and can be queried with `dr-status.sh`.
