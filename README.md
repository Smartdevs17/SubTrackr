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

### Prerequisites

**Required:**

- [Node.js 20+](https://nodejs.org/) (LTS version recommended)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Yarn](https://yarnpkg.com/) or [npm](https://www.npmjs.com/)
- [Git](https://git-scm.com/)

**For Smart Contract Development:**

- [Rust](https://www.rust-lang.org/tools/install) 1.75+
- [Soroban CLI](https://soroban.stellar.org/docs/installation/soroban-cli)
- [Stellar Horizon](https://github.com/stellar/go) (optional, for local testing)

**Wallet:**

- [Freighter Wallet](https://freighter.app/) browser extension
- Development account (get testnet XLM from [Stellar Faucet](https://friend.stellar.org/))

### Step-by-Step Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/Smartdevs17/SubTrackr.git
cd SubTrackr
```

#### 2. Install Dependencies

```bash
# Install mobile app dependencies
npm install
# or: yarn install

# Install contract dependencies
cd contracts
cargo install --locked soroban-cli
cd ..
```

#### 3. Environment Setup

Copy the environment template and configure:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

- `STELLAR_NETWORK`= `testnet` or `mainnet`
- `CONTRACT_ID`= Deployed Soroban contract ID
- `WEB3AUTH_CLIENT_ID`= Your Web3Auth client ID
- `RPC_URL`= Stellar RPC endpoint URL

#### 4. Link Freighter Wallet

Connect your Freighter wallet for transaction signing:

```bash
# Install the browser extension
# Navigate to app and tap "Connect Wallet"
# Follow the in-app prompts
```

#### 5. Run the App Locally

**Mobile App:**

```bash
npm start
# Scan QR code with Expo Go app or press 'a' for Android, 'i' for iOS

# Run on simulator/emulator
npm run android
npm run ios
```

**Smart Contracts (Development):**

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm --network testnet
# Save the deployed contract ID to .env
```

### Running Tests

**Unit Tests:**

```bash
npm test
```

**Contract Tests:**

```bash
cd contracts
cargo test
```

**Integration Tests:**

```bash
npm run test:integration
```

### Troubleshooting

**Issue:** Expo app not starting
- **Solution:** Check Node.js version (`node -v`), ensure Node 20+ is installed
- Try `npm start -- --clear` to clear cache

**Issue:** Smart contract compilation fails
- **Solution:** Update Rust toolchain: `rustup update`
- Ensure WASM target: `rustup target add wasm32-unknown-unknown`

**Issue:** Freighter wallet not connecting
- **Solution:** Check Freighter extension is installed and unlocked
- Ensure you're on Stellar network (mainnet or testnet)

**Issue:** Testnet XLM faucet issues
- **Solution:** Try alternative faucets: [Stellar Developer Portal](https://stellar.org/faucet) or [Friendbot](https://friendbot.stellar.org/)

**Issue:** Environment variables not loading
- **Solution:** Verify `.env` file exists (not `.env.example`)
- Check file permissions and restart the metro bundle

### Development Workflow

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and test locally
3. Run tests: `npm test && npm run lint`
4. Commit with meaningful messages: `git commit -m "feat: add new subscription type"`
5. Push and create PR: `git push origin feature/my-feature`

### Contributing

We welcome contributions! SubTrackr participates in the **Stellar Wave Program** via [Drips](https://www.drips.network/). Contributors can earn points and rewards by picking up issues labeled **`Stellar Wave`**.

Types of contributions we're looking for:

- **Soroban contract features** — billing cycle logic, grace periods, merchant management
- **Mobile UI/UX** — new screens, improved flows, accessibility
- **Wallet integration** — Freighter deep linking, transaction signing
- **Testing** — unit tests, integration tests, contract tests
- **Documentation** — setup guides, architecture docs, API references
- **Notification system** — push notifications, billing alerts

Look for issues tagged `good first issue` or `Stellar Wave` to get started.

## License

MIT
