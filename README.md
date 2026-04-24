[![Security](https://github.com/Smartdevs17/SubTrackr/actions/workflows/security-scan.yml/badge.svg)](https://github.com/Smartdevs17/SubTrackr/actions/workflows/security-scan.yml)
[![Dependabot Status](https://img.shields.io/badge/Dependabot-active-brightgreen.svg)](https://github.com/Smartdevs17/SubTrackr/security/dependabot)

# SubTrackr - On-Chain Subscription Management on Stellar

SubTrackr is a mobile application for managing recurring payments and subscriptions powered by Soroban smart contracts on the Stellar network. Merchants create subscription plans, users authorize recurring XLM or token payments, and smart contracts handle automated billing cycles.

## The Problem

- Average person manages 12+ subscriptions with no unified view
- No native on-chain solution for recurring payments on Stellar
- Missed payments lead to service interruptions and late fees
- No easy way to pay for services with crypto on a recurring basis

## Features

**Subscription Management**

- Track all subscriptions (Web2 and Web3 services) in one place
- Smart categorization by type (streaming, productivity, infrastructure, etc.)
- Quick-add presets for popular services or manual entry
- Bulk actions: pause, cancel, or modify multiple subscriptions

**On-Chain Recurring Payments**

- Authorize recurring XLM and Stellar token payments via Soroban contracts
- Automatic billing cycle execution with configurable intervals
- Multi-token support (XLM, USDC on Stellar, custom Stellar assets)
- Transparent on-chain payment history

**Smart Notifications**

- Billing reminders with advance warnings before charges
- Price change alerts and spending insights
- AI-powered savings suggestions

**Wallet Integration**

- Native Freighter wallet connection for Stellar transactions
- Social login support via Web3Auth
- Real-time balance and transaction monitoring

## Architecture

```
SubTrackr/
├── src/              # React Native mobile app (Expo)
│   ├── screens/      # App screens
│   ├── components/   # Reusable UI components
│   ├── services/     # Wallet and API services
│   ├── store/        # Zustand state management
│   └── hooks/        # Custom React hooks
├── contracts/        # Soroban smart contracts (Rust)
│   └── src/          # Subscription management contract
├── stellarlend/      # Optional local clone of the lending protocol (separate Git repo; see below)
```

## Tech Stack

| Layer           | Technology                     |
| --------------- | ------------------------------ |
| Mobile App      | React Native, Expo, TypeScript |
| State           | Zustand                        |
| Wallet          | Freighter Wallet, Stellar SDK  |
| Auth            | Web3Auth (social login)        |
| Smart Contracts | Soroban (Rust) on Stellar      |
| Payments        | XLM, Stellar tokens            |

## Getting Started

### 1. Clone the Repository

First, clone the repository to your local machine:

```bash
git clone https://github.com/Smartdevs17/SubTrackr.git
cd SubTrackr
```

### 2. Install Prerequisites

#### Required for all development:

- **Node.js 20+**: We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions:

  ```bash
  # Install nvm (if not already installed)
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

  # Install and use Node.js 20
  nvm install 20
  nvm use 20
  ```

- **Expo CLI**: Install the Expo command line tools globally:
  ```bash
  npm install -g expo-cli
  ```
- **Freighter Wallet**: Install the [Freighter Wallet](https://freighter.app/) browser extension for Stellar transaction signing.

#### Required only for smart contract development:

- **Rust**: Install Rust and the WASM target:

  ```bash
  # Install Rust (if not already installed)
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  # Add WASM target
  rustup target add wasm32-unknown-unknown
  ```

- **Soroban CLI**: Install the Soroban command line tools:
  ```bash
  cargo install --locked soroban-cli
  ```

### 3. Configure Environment Variables

Create a `.env` file in the root directory of the project:

```bash
cp .env.example .env
```

> **Note**: If `.env.example` doesn't exist, create a new `.env` file with the following variables:

| Variable             | Description                               | Example Value                                                     |
| -------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `STELLAR_NETWORK`    | `testnet` or `public` Stellar network     | `testnet`                                                         |
| `CONTRACT_ID`        | Deployed SubTrackr proxy contract ID (stable) | `CB64...` (your deployed proxy contract address)               |
| `WEB3AUTH_CLIENT_ID` | Web3Auth client ID for social login       | Get one from [Web3Auth Dashboard](https://dashboard.web3auth.io/) |

### 4. Run the Mobile App

Install dependencies and start the Expo development server:

```bash
# Install dependencies
npm install

# Start Expo dev server
npx expo start
```

You can then run the app on:

- **iOS Simulator**: Press `i` in the Expo terminal
- **Android Emulator**: Press `a` in the Expo terminal
- **Physical Device**: Scan the QR code with the Expo Go app (iOS/Android)

### 5. (Optional) Deploy Smart Contracts

If you want to work on the smart contracts:

```bash
# Local (requires local Soroban network + `alice` identity)
./scripts/deploy-local.sh

# Testnet
export SOROBAN_ACCOUNT="your-testnet-identity"
export ADMIN_ADDRESS="GB..."
./scripts/deploy-testnet.sh
```

SubTrackr uses an upgradeable architecture (proxy + storage + implementation). Use the deployed `PROXY_ID` (saved to `contracts/.env.<network>`) as the stable contract ID.

### 6. Run Tests

Run the test suite to ensure everything is working correctly:

```bash
# Run unit tests
npm test

# Run lint checks
npm run lint
```

### Troubleshooting

<details>
<summary>Expo server won't start</summary>
- Ensure no other process is using port 8081: `lsof -i :8081 | kill -9 <PID>`
- Clear Expo cache: `npx expo start --clear`
</details>

<details>
<summary>Smart contract build fails</summary>
- Ensure you have the WASM target installed: `rustup target add wasm32-unknown-unknown`
- Update Soroban CLI to the latest version: `cargo install --locked soroban-cli --force`
</details>

<details>
<summary>Wallet connection issues</summary>
- Ensure Freighter Wallet is installed and unlocked
- Make sure you're connected to the same Stellar network as the app (testnet/public)
</details>

## Contributing

We welcome contributions! SubTrackr participates in the **Stellar Wave Program** via [Drips](https://www.drips.network/). Contributors can earn points and rewards by picking up issues labeled **`Stellar Wave`**.

Types of contributions we're looking for:

- **Soroban contract features** — billing cycle logic, grace periods, merchant management
- **Mobile UI/UX** — new screens, improved flows, accessibility
- **Wallet integration** — Freighter deep linking, transaction signing
- **Testing** — unit tests, integration tests, contract tests
- **Documentation** — setup guides, architecture docs, API references
- **Notification system** — push notifications, billing alerts

Look for issues tagged `good first issue` or `Stellar Wave` to get started.

## Automated Releases

SubTrackr uses `semantic-release` with Conventional Commits to automate versioning, changelog generation, GitHub Releases, and npm publishing.

- Commit format: use Conventional Commits (for example, `feat:`, `fix:`, `chore:`)
- CI enforcement: pull requests run commit lint checks in GitHub Actions
- Release trigger: when the `CI/CD Pipeline` workflow succeeds on `main`, the `Release` workflow runs `semantic-release`
- Generated artifacts:
  - `CHANGELOG.md` is updated automatically
  - GitHub Release is created with generated notes
  - npm package is published from `package.json`

Required repository secrets:

- `NPM_TOKEN` with publish access to the npm package

Run locally in dry mode:

```bash
npm run release:dry-run
```

## Security

SubTrackr prioritizes the security of your subscriptions and on-chain transactions.

- **Dependency Scanning**: Powered by GitHub Dependabot and `npm audit`.
- **Security Monitoring**: Automated workflows run high-level vulnerability scans on every push and pull request.
- **Reporting**: Found a vulnerability? Please see our [Security Policy](docs/security.md) for reporting guidelines.

To run a manual security audit:
```bash
npm run security:audit
```

## License

MIT
