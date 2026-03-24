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

- Node.js 20+
- Expo CLI
- Rust + Soroban CLI (for contract development)
- [Freighter Wallet](https://freighter.app/)

### Mobile App

```bash
npm install
npx expo start
```

### Smart Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm --network testnet
```

### Environment Variables

| Variable             | Description                               |
| -------------------- | ----------------------------------------- |
| `STELLAR_NETWORK`    | `testnet` or `public`                     |
| `CONTRACT_ID`        | Deployed Soroban subscription contract ID |
| `WEB3AUTH_CLIENT_ID` | Web3Auth client ID for social login       |

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

## License

MIT
