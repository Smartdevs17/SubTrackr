# Multi-Provider Billing Strategy Architecture

Comprehensive guide and API specification for the pluggable multi-provider billing strategy pattern supporting Web2 and Web3 providers for enterprise-scale subscription management.

Closes #2203

---

## 1. Overview & Architectural Motivation

Enterprise subscription platforms require flexible, pluggable billing architectures capable of processing charges across heterogeneous payment networks:
- **Web2 Rails**: Credit cards, SEPA, customer portals (Stripe), digital wallets (PayPal), and corporate bank rails (Wire / ACH).
- **Web3 Rails**: Native Soroban / Stellar smart contract escrow (XLM, USDC) and EVM networks (Ethereum, Polygon, Base).

The Multi-Provider Billing Strategy Pattern isolates provider-specific mechanics behind a unified contract:
1. **Zero Vendor Lock-In**: New payment providers implement `BillingProviderStrategy` and plug into `BillingProviderRegistry`.
2. **Automated Fallback Cascading**: When a primary provider experiences transient network errors or gateway degradation, requests seamlessly cascade down configured fallback chains.
3. **On-Chain Settlement Verification**: On-chain attestation in Soroban smart contracts (`contracts/subscription/src/billing.rs`) records immutable proofs of payment regardless of whether settlement occurred on Web2 or Web3 rails.
4. **Client-Side Optimization**: `MultiProviderBillingClient` intelligently selects the optimal provider based on currency, wallet connectivity, and fee minimization.

---

## 2. Core Architecture & Interfaces

### 2.1 Backend Strategy Interface (`backend/services/billing/multiProviderBillingStrategy.ts`)

Every billing provider implements `BillingProviderStrategy`:

```typescript
export interface BillingProviderStrategy {
  readonly providerId: BillingProviderId;
  readonly category: BillingCategory; // 'web2' | 'web3'
  readonly capabilities: BillingProviderCapabilities;
  readonly supportedCurrencies: string[];

  validateParams(request: BillingChargeRequest): ProviderValidationResult;
  calculateFee(amount: number, currency: string): FeeEstimate;
  executeCharge(request: BillingChargeRequest): Promise<BillingChargeResult>;
  executeRefund(request: BillingRefundRequest): Promise<BillingRefundResult>;
  verifyWebhook(
    payload: string | Buffer,
    headers: Record<string, string>
  ): Promise<{ verified: boolean; event?: any; error?: string }>;
  getHealth(): Promise<{ healthy: boolean; latencyMs: number }>;
}
```

### 2.2 Concrete Provider Strategies

| Provider Strategy | Category | Supported Currencies | Capabilities | Fee Structure |
|-------------------|----------|----------------------|--------------|---------------|
| `StripeBillingStrategy` | `web2` | USD, EUR, GBP, CAD, AUD, JPY, USDC | Recurring, Usage-Based, Refunds, Disputes, Webhooks | 2.9% + $0.30 |
| `PayPalBillingStrategy` | `web2` | USD, EUR, GBP, CAD, AUD | Recurring, Refunds, Disputes, Webhooks | 3.49% + $0.49 |
| `WireAchBillingStrategy` | `web2` | USD, EUR | Recurring (ACH debit), Refunds, Webhooks | 0.8% (capped at $5) / $25 Wire |
| `StellarBillingStrategy` | `web3` | XLM, USDC, EURC | Recurring, Usage-Based, Refunds, On-Chain Settlement | 0.00001 XLM (100 stroops) |
| `EVMBillingStrategy` | `web3` | ETH, USDT, USDC, DAI, MATIC | Recurring, On-Chain Settlement, Immediate | ~0.0015 ETH gas estimate |

---

## 3. Dynamic Resolution & Fallback Engine

The `MultiProviderBillingEngine` provides automated routing and fault-tolerant fallback execution:

```typescript
import { multiProviderBillingEngine } from '../services/billing';

// Automated resolution and charge with fallback:
const result = await multiProviderBillingEngine.chargeWithFallback(
  {
    id: 'req_12345',
    subscriptionId: 'sub_99',
    customerId: 'cust_abc',
    amount: 99.00,
    currency: 'USD',
  },
  ['stripe', 'paypal', 'wire_ach'] // Fallback sequence
);

if (result.success) {
  console.log(`Charged via ${result.providerId}, status: ${result.status}`);
} else {
  console.error(`Exhausted providers: ${result.errorMessage}`);
}
```

### Provider Resolution Precedence

1. **Explicit Provider**: If `request.providerId` is provided and registered, use it directly.
2. **Wallet Address Shape**:
   - `G...` (56-character base32 ed25519) -> routes to `StellarBillingStrategy`.
   - `0x...` (40-hex characters) -> routes to `EVMBillingStrategy`.
3. **Currency Inference**:
   - `XLM`, `USDC-STELLAR` -> routes to `StellarBillingStrategy`.
   - `ETH`, `USDT`, `DAI`, `MATIC` -> routes to `EVMBillingStrategy`.
4. **Default Web2 Provider**: Routes to default fiat provider (`StripeBillingStrategy`).

---

## 4. Soroban Smart Contract Integration

On-chain settlement records in `contracts/subscription/src/billing.rs`:

```rust
pub enum BillingProviderType {
    SorobanNative = 0,
    EVMBridge = 1,
    Web2Stripe = 2,
    Web2PayPal = 3,
    Web2WireAch = 4,
}

pub struct ProviderSettlementRecord {
    pub subscription_id: u64,
    pub invoice_id: u64,
    pub provider_type: BillingProviderType,
    pub amount: i128,
    pub fee: i128,
    pub net_amount: i128,
    pub settled_at: u64,
    pub reference_hash: BytesN<32>,
    pub is_refunded: bool,
}
```

Contract Functions:
- `set_provider_config(env, provider_type, config)`
- `get_provider_config(env, provider_type) -> Option<BillingProviderConfig>`
- `record_provider_settlement(env, subscription_id, invoice_id, provider_type, amount, reference_hash)`
- `get_provider_settlement(env, subscription_id, invoice_id) -> Option<ProviderSettlementRecord>`
- `refund_provider_settlement(env, subscription_id, invoice_id) -> Result<ProviderSettlementRecord, ()>`

---

## 5. Client-Side Orchestration (`MultiProviderBillingClient`)

The client-side service (`src/services/multiProviderBillingClient.ts`) provides checkout management:

```typescript
import { multiProviderBillingClient } from '../services/multiProviderBillingClient';

// 1. Get filtered billing options with fee estimates
const options = multiProviderBillingClient.getAvailableProviders('XLM', true);

// 2. Initiate checkout
const session = await multiProviderBillingClient.initiateCheckout({
  subscriptionId: 'sub_enterprise_01',
  planId: 'plan_scale',
  amount: 250,
  currency: 'XLM',
  walletAddress: userConnectedAddress,
});
```

---

## 6. Verification & Test Execution

### Backend Tests
```bash
npx jest --config jest.backend.config.js backend/services/billing/__tests__/multiProviderBilling.test.ts
```

### Client Tests
```bash
npx jest --config jest.backend.config.js src/services/__tests__/multiProviderBillingClient.test.ts
```

### Smart Contract Tests
```bash
cd contracts && cargo test -p subtrackr-subscription
```
