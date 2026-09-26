# Runbook: Deployment Procedures

Covers contract deployment, app releases, and rollback procedures for all environments.

---

## Environments

| Environment | Network         | RPC URL                               | Purpose      |
| ----------- | --------------- | ------------------------------------- | ------------ |
| Local       | Local Soroban   | `http://localhost:8000`               | Development  |
| Testnet     | Stellar Testnet | `https://soroban-testnet.stellar.org` | Staging / QA |
| Mainnet     | Stellar Public  | `https://soroban.stellar.org`         | Production   |

---

## Pre-Deployment Checklist

- [ ] All tests pass: `npm test`
- [ ] DR drill passes: `npm run dr:drill`
- [ ] No high/critical vulnerabilities: `npm audit`
- [ ] Contract compiled without warnings: `cargo clippy`
- [ ] `SOROBAN_ACCOUNT` and `ADMIN_ADDRESS` env vars set
- [ ] Sufficient XLM balance on deploying account (mainnet only)
- [ ] Previous `CONTRACT_ID` backed up

---

## Contract Deployment

### 1. Build the Contract

```bash
cargo build --release \
  --target wasm32-unknown-unknown \
  --manifest-path contracts/Cargo.toml
```

Output: `target/wasm32-unknown-unknown/release/subtrackr.wasm`

### 2. Deploy

**Local:**

```bash
./scripts/deploy-local.sh
```

**Testnet:**

```bash
export SOROBAN_ACCOUNT="your-testnet-account-name"
export ADMIN_ADDRESS="GB..."
./scripts/deploy-testnet.sh
```

**Mainnet:**

```bash
export SOROBAN_ACCOUNT="your-mainnet-account-name"
export ADMIN_ADDRESS="GD..."
./scripts/deploy-mainnet.sh
```

The script saves the new `CONTRACT_ID` to `contracts/.env.<network>`.

### 3. Initialize the Contract

The deploy scripts call `initialize` automatically. If running manually:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- initialize \
  --admin $ADMIN_ADDRESS
```

> `initialize` can only be called once. Calling it again will panic.

### 4. Verify Deployment

```bash
./scripts/verify.sh $CONTRACT_ID $NETWORK

# Or manually:
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_plan_count
# Expected: 0 (fresh contract)
```

---

## App Release

### Mobile (React Native / Expo)

```bash
# Build release bundle
./build-release.sh

# Or manually:
npx expo build:android --release-channel production
npx expo build:ios --release-channel production
```

Update `CONTRACT_ID` in app environment before building:

```bash
# .env.production
CONTRACT_ID=C...
SOROBAN_NETWORK=public
```

### Environment Variables Reference

| Variable          | Description                         | Required    |
| ----------------- | ----------------------------------- | ----------- |
| `CONTRACT_ID`     | Deployed Soroban contract ID        | Yes         |
| `SOROBAN_ACCOUNT` | Soroban CLI identity for deployment | Deploy only |
| `ADMIN_ADDRESS`   | Contract admin Stellar address      | Deploy only |
| `SOROBAN_RPC_URL` | Override default RPC endpoint       | Optional    |

---

## Rollback Procedure

Soroban contracts are immutable. Rollback means deploying a previous or fixed version as a new contract.

### Contract Rollback

1. Identify the last known-good WASM (check git tags or `contracts/.env.<network>` history)
2. Deploy the previous WASM as a new contract:
   ```bash
   soroban contract deploy \
     --wasm target/wasm32-unknown-unknown/release/subtrackr_v<PREV>.wasm \
     --network $NETWORK
   ```
3. Initialize the new contract with the same admin
4. Update `CONTRACT_ID` in app config and redeploy the app
5. Migrate active subscriptions if needed (manual re-subscription or data migration script)

### App Rollback

```bash
# Revert to previous git tag
git checkout v<PREV_VERSION>
./build-release.sh
```

---

## Post-Deployment Verification

Run after every deployment:

```bash
# 1. Contract responds
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_subscription_count

# 2. DR drill passes
npm run dr:drill

# 3. Create a test plan and subscribe (testnet only)
soroban contract invoke --id $CONTRACT_ID --network testnet \
  -- create_plan \
  --merchant $TEST_MERCHANT \
  --name "Smoke Test Plan" \
  --price 1000000 \
  --token $TEST_TOKEN \
  --interval Weekly
```

---

## Source Verification (Mainnet)

After mainnet deployment, publish source for transparency:

```bash
cargo build --release --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml
./scripts/package-source.sh
# Upload dist/subtrackr-source.tar.gz to Stellar Expert contract page
```
