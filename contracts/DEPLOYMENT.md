# SubTrackr Contract Deployment Guide

This guide describes how to deploy SubTrackr smart contracts to various Stellar networks using the provided automation scripts.

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

| Variable          | Description                                                                        | Required For     |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------- |
| `SOROBAN_ACCOUNT` | The identity name (configured in Soroban CLI) or secret key to use for deployment. | Testnet, Mainnet |
| `ADMIN_ADDRESS`   | The Stellar address that will be set as the contract admin during initialization.  | Testnet, Mainnet |

## Verification

After deployment, you can verify that the contract is active by running:

```bash
./scripts/verify.sh <CONTRACT_ID> <NETWORK>
```

Replace `<CONTRACT_ID>` with the ID returned by the deployment script and `<NETWORK>` with `local`, `testnet`, or `public`.

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

1) Build the WASM (optional, for checksum reference):

```bash
cargo build --release --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml
```

2) Package the contract source:

```bash
./scripts/package-source.sh
```

This generates a tar.gz in `dist/` containing:
- `contracts/Cargo.toml`
- `contracts/src/**`
- `WASM_SHA256.txt` (if a compiled WASM was found)

3) Upload the tar.gz bundle to your chosen explorer’s contract page (or submit via their form/API), referencing your deployed `CONTRACT_ID`.

Notes:
- Ensure the license header is present in your sources if required by the explorer.
- Keep optimizer/toolchain settings consistent across builds for reproducibility.

## Rollback Procedure

Since smart contracts on Soroban are immutable (unless explicitly designed otherwise), a "rollback" typically involves:

1. Fixing the issue in the contract source code.
2. Deploying a new version of the contract.
3. Updating the application (frontend/backend) to use the new `CONTRACT_ID`.

Ensure you keep track of the `CONTRACT_ID` for each deployment (these are automatically saved to `contracts/.env.<network>`).

With the migration framework, you can restore the active contract pointer using the history artifact:

```bash
./scripts/rollback-migration.sh \
  --history-file contracts/migrations/history/<MIGRATION_HISTORY_FILE>.env
```
