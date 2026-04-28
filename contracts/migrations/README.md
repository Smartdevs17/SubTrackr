# Contract Migration Framework

This directory contains the SubTrackr contract migration framework for Soroban redeployments.

## Goals

- Export plan and subscription snapshots before a cutover.
- Support blue-green style redeployments for zero-downtime client cutovers.
- Validate the replacement contract before switching the active contract pointer.
- Keep a machine-readable history file for rollback and auditing.

## Structure

- `lib.sh`: shared migration helpers.
- `001_blue_green_cutover.sh`: baseline migration that snapshots the old contract, deploys a new one, initializes it, validates read access, and updates `contracts/.env.<network>`.
- `history/`: generated migration records.
- `snapshots/`: exported plan and subscription data from the source contract.

## Current Migration Model

Soroban contracts in this repository are immutable and the current contract does not expose admin import endpoints. Because of that, the migration framework treats migrations as:

1. Exporting the source contract's on-chain data for validation and operator review.
2. Deploying and initializing a replacement contract.
3. Switching the application's active contract pointer only after validation succeeds.
4. Allowing rollback by restoring the previous `CONTRACT_ID`.

That cutover model provides an operationally safe migration path today while leaving room for future state rehydration hooks.
