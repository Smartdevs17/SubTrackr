# SubTrackr Contract Deployment Guide

This guide describes how to deploy SubTrackr smart contracts to various Stellar networks using the provided automation scripts.

## Contract Architecture (Upgradeable)

SubTrackr is deployed as three Soroban contracts:

- **Proxy** (`subtrackr-proxy` / `UpgradeableProxy`): Stable contract ID used by the app. Manages upgrades (timelock, history, rollback scheduling) and forwards calls to the current implementation.
- **Storage** (`subtrackr-storage` / `SubTrackrStorage`): Holds all subscription state (plans, subscriptions, indexes). Only the currently-authorized implementation can write to it.
- **Implementation** (`subtrackr-subscription` / `SubTrackrSubscription`): Business logic. Can be upgraded by deploying a new implementation contract and updating the proxy.

The **proxy contract ID never changes** during upgrades, so subscribers and integrators don’t need to update addresses.

## Prerequisites

- [Soroban CLI](https://developers.stellar.org/docs/smart-contracts/getting-started/setup#install-the-soroban-cli) installed.
- [Rust](https://rustup.rs/) and `wasm32-unknown-unknown` target installed.
- A Stellar account with enough XLM for the target network.

## Deployment Scripts

All scripts are located in the `scripts/` directory at the project root.

### 1. Local Deployment

For development and testing on a local Soroban network.

```bash
./scripts/deploy-local.sh
```

**Note**: Assumes a local network is running and an identity `alice` exists.

### 2. Testnet Deployment

For deploying to the Stellar Testnet.

```bash
export SOROBAN_ACCOUNT="your-testnet-account-name"
export ADMIN_ADDRESS="GB..."
./scripts/deploy-testnet.sh
```

### 3. Mainnet Deployment

For deploying to the Stellar Public network (Mainnet).

```bash
export SOROBAN_ACCOUNT="your-mainnet-account-name"
export ADMIN_ADDRESS="GD..."
./scripts/deploy-mainnet.sh
```

**⚠️ WARNING**: Mainnet deployment costs real XLM. Ensure you have sufficient funds and have reviewed the contract code.

## Environment Variables

| Variable              | Description                                                                        | Required For     |
| --------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| `SOROBAN_ACCOUNT`     | The identity name (configured in Soroban CLI) or secret key to use for deployment. | Testnet, Mainnet |
| `ADMIN_ADDRESS`       | The Stellar address that will be set as the contract admin during initialization.  | Testnet, Mainnet |
| `UPGRADE_DELAY_SECS`  | Minimum delay (seconds) between scheduling and executing an upgrade.               | Testnet, Mainnet |
| `ROLLBACK_DELAY_SECS` | Delay (seconds) used when scheduling a rollback via `rollback()`.                  | Testnet, Mainnet |

## Verification

After deployment, you can verify that the contract is active by running:

```bash
./scripts/verify.sh <PROXY_ID> <NETWORK> [SOURCE]
```

Replace `<PROXY_ID>` with the proxy contract ID returned by the deployment script and `<NETWORK>` with `local`, `testnet`, or `public`.

## Migrations

For contract upgrades and cutovers, use the migration framework instead of ad-hoc redeploys:

```bash
export NETWORK="testnet"
export SOURCE_ACCOUNT="your-testnet-account-name"
export ADMIN_ADDRESS="GB..."
./scripts/run-migration.sh --network "$NETWORK" --source "$SOURCE_ACCOUNT" --admin "$ADMIN_ADDRESS"
```

What this does:
- Exports a plan and subscription snapshot from the active contract.
- Deploys and initializes a replacement contract.
- Validates the replacement contract's read paths.
- Updates `contracts/.env.<network>` only after validation passes.
- Records a rollback-ready history file in `contracts/migrations/history/`.

Dry-run example:

```bash
export NETWORK="testnet"
export SOURCE_ACCOUNT="your-testnet-account-name"
export ADMIN_ADDRESS="GB..."
./scripts/run-migration.sh --network "$NETWORK" --source "$SOURCE_ACCOUNT" --admin "$ADMIN_ADDRESS" --dry-run
```

Validate a target contract and inspect the exported snapshot:

```bash
./scripts/validate-migration.sh \
  --network testnet \
  --target-contract <NEW_CONTRACT_ID> \
  --snapshot-dir contracts/migrations/snapshots/<SNAPSHOT_DIRECTORY>
```

### Explorer Source Verification

Some explorers (e.g., Stellar Expert / Soroban explorers) support attaching source bundles for transparency.

1. Build the WASM (optional, for checksum reference):

```bash
cargo build --release --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml
```

2. Package the contract source:

```bash
./scripts/package-source.sh
```

This generates a tar.gz in `dist/` containing:

- `contracts/Cargo.toml`
- `contracts/proxy/**`
- `contracts/storage/**`
- `contracts/subscription/**`
- `contracts/types/**`
- `WASM_SHA256.txt` (if a compiled WASM was found)

3. Upload the tar.gz bundle to your chosen explorer’s contract page (or submit via their form/API), referencing your deployed `PROXY_ID` (and optionally the storage/implementation IDs).

Notes:

- Ensure the license header is present in your sources if required by the explorer.
- Keep optimizer/toolchain settings consistent across builds for reproducibility.

## Upgrade Procedure

### 1) Deploy a new implementation

Build and deploy the updated `subtrackr-subscription` contract.
You can use the helper script (deploy + schedule):

```bash
export SOROBAN_ACCOUNT="your-network-identity"
export ADMIN_ADDRESS="G..."
./scripts/upgrade-deploy-and-schedule.sh <PROXY_ID> <NETWORK>
```

This deploys a new implementation and schedules the upgrade via `authorize_upgrade`.

### 2) Wait for the timelock

Upgrades are timelocked. The proxy enforces:

- `execute_after >= now + upgrade_delay_secs`

### 3) Execute the upgrade

```bash
./scripts/upgrade-execute.sh <PROXY_ID> <IMPLEMENTATION_ID> <NETWORK>
```

Execution calls `upgrade_to(implementation)` which:

- Updates the storage contract to authorize writes from the new implementation
- Runs `validate_upgrade(...)` and `migrate(...)` when needed
- Updates `get_version()` (storage schema version)
- Appends to upgrade history

### Storage Migrations & Versions

`get_version()` on the proxy represents the **storage schema version**.

When changing storage layout between versions:

- Bump the implementation’s `STORAGE_VERSION`
- Implement `migrate(proxy, storage, from_version)`
- Keep migrations **forward-only** and deterministic

## Rollback Procedure (Timelocked)

If the latest implementation is faulty, the proxy can schedule a rollback to the immediately-previous implementation:

1. Schedule rollback:

```bash
./scripts/rollback-schedule.sh <PROXY_ID> <NETWORK>
```

2. After the rollback delay elapses, execute the scheduled rollback with `upgrade_to(...)`.

Notes:

- Rollback changes the **implementation**, not the already-applied storage schema.
- Keep older implementations forward-compatible when possible (e.g., additive storage changes).

## Migration History Rollback

The migration framework added in this branch is still useful for operational cutovers that track an
active contract pointer outside the proxy upgrade path.

Restore the last recorded active contract from migration history with:

```bash
./scripts/rollback-migration.sh \
  --history-file contracts/migrations/history/<MIGRATION_HISTORY_FILE>.env
```
