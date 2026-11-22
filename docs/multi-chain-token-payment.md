# Multi-Chain Token Payment Strategy

Issue #2213 — Chain-agnostic token handler for payment abstraction.

## Overview

SubTrackr settles subscription charges in both fiat (via Stripe, Circle, Paddle)
and on-chain tokens. The existing `PaymentRouter` handles fiat routing across
gateway adapters, but token payments — ERC20 transfers on EVM chains and
native Stellar asset transfers via Soroban contracts — need a different
abstraction: there is no gateway, just a contract call.

This module provides a **strategy interface** and concrete adapters that let
the backend settle a subscription charge in any token on any chain through one
`charge()` call.

## Architecture

```
TokenPaymentRequest ──▶ TokenPaymentRouter
                              │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
             ERC20Strategy  SorobanStrategy  (extensible)
                  │           │
                  ▼           ▼
             EVM RPC     Stellar SDK
             (ethers)    (soroban-sdk)
```

### Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `ITokenPaymentStrategy` | `backend/services/payment/domain/tokenPaymentStrategy.ts` | Strategy interface for chain-specific token transfers |
| `ERC20TokenPaymentStrategy` | same | EVM ERC20 token transfers via injectable RPC client |
| `SorobanTokenPaymentStrategy` | same | Stellar/Soroban token transfers via injectable Soroban client |
| `TokenPaymentRouter` | same | Routes requests by chain type, handles fallback across chains |
| `TokenPaymentService` | `src/services/tokenPaymentService.ts` | Frontend client that prepares requests and delegates to backend API |
| `payment.rs` | `contracts/subscription/src/` | Soroban contract that executes `token::Client.transfer()` |

## Usage

### Backend: charge a subscription in USDC on Ethereum

```typescript
import { TokenPaymentRouter, ERC20TokenPaymentStrategy } from './domain/tokenPaymentStrategy';

const evmClient = getEvmRpcClient('1'); // mainnet
const strategy = new ERC20TokenPaymentStrategy({ '1': evmClient });
const router = new TokenPaymentRouter([strategy], {
  fallbackChains: { '1': ['137'] }, // fall back to Polygon
});

const result = await router.charge({
  paymentId: 'tp_abc123',
  subscriptionId: 'sub_42',
  from: '0xPayer',
  to: '0xMerchant',
  amount: '1000000', // 1 USDC (6 decimals)
  tokenAddress: '0xA0b86991c62137b1a635c7142E7a3E9aDbC95d80',
  tokenSymbol: 'USDC',
  chainId: '1',
  chainType: 'evm',
});
```

### Backend: charge in XLM on Stellar

```typescript
import { SorobanTokenPaymentStrategy } from './domain/tokenPaymentStrategy';

const sorobanClient = getSorobanClient();
const strategy = new SorobanTokenPaymentStrategy(sorobanClient);
const router = new TokenPaymentRouter([strategy]);

const result = await router.charge({
  paymentId: 'tp_xyz789',
  subscriptionId: 'sub_42',
  from: 'GA...',
  to: 'GB...',
  amount: '10000000', // 1 XLM (7 decimals → stroops)
  tokenAddress: 'CAS3JK7...',
  tokenSymbol: 'XLM',
  chainId: 'Public Global Stellar Network ; September 2015',
  chainType: 'stellar',
});
```

### Frontend: prepare and submit a token payment

```typescript
import { buildTokenPaymentRequest, TokenPaymentService } from '../services/tokenPaymentService';

const request = buildTokenPaymentRequest({
  subscriptionId: 'sub_42',
  from: walletAddress,
  to: merchantAddress,
  amount: '1000000',
  tokenAddress: tokenContractAddress,
  tokenSymbol: 'USDC',
  chainId: '1',
  chainType: 'evm',
});

const service = TokenPaymentService.getInstance();
const result = await service.charge(request);
```

## Fallback Chains

When the primary chain is unhealthy or the charge fails, the router can fall
back to alternative chains configured via `fallbackChains`. This mirrors the
settlement semantics in `MultiChainSubscriptionService.planSettlement`.

```typescript
const router = new TokenPaymentRouter([erc20, soroban], {
  fallbackChains: {
    '1': ['137', '42161'],                     // Ethereum → Polygon → Arbitrum
    '137': ['1', '42161'],                     // Polygon → Ethereum → Arbitrum
    'Public Global Stellar Network ; September 2015': ['1'], // Stellar → Ethereum
  },
});
```

## Soroban Contract Side

The existing `contracts/subscription/src/payment.rs` already handles Soroban
token transfers via `token::Client::new(env, &plan.token).transfer(...)`. This
works with any SAC-compatible token (USDC, custom Stellar assets). The
`charge_subscription` function performs the transfer and emits a
`subscription_charged` event.

The `resolve_charge_price` function optionally consults a price oracle to
adjust the charge amount within configured bounds, ensuring payments stay
within acceptable price ranges even when token prices fluctuate.

## Testing

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/backend/services/payment/domain/__tests__/tokenPaymentStrategy.test.ts' \
  --coverage --collectCoverageFrom='backend/services/payment/domain/tokenPaymentStrategy.ts'
```

Coverage: 98% statements, 82% branches, 100% functions, 99% lines.
