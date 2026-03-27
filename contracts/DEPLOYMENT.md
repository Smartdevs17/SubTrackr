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

## Rollback Procedure

Since smart contracts on Soroban are immutable (unless explicitly designed otherwise), a "rollback" typically involves:

1. Fixing the issue in the contract source code.
2. Deploying a new version of the contract.
3. Updating the application (frontend/backend) to use the new `CONTRACT_ID`.

Ensure you keep track of the `CONTRACT_ID` for each deployment (these are automatically saved to `contracts/.env.<network>`).
