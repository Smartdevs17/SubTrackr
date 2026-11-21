# Mobile wallet connect flow

Issue #2011 — `mobile/src/wallet/`

## Overview

A provider-neutral connect flow supporting two wallet families:

- **Freighter** (`freighter.ts`) — Stellar extension provider resolved from
  `globalThis.freighterApi`, `freighter` or `stellar`, with injection for tests.
- **WalletConnect v2** (`walletConnectV2.ts`) — injected v2 connector with
  CAIP-2 chain selection, pairing URI builder and account normalisation.

`connectFlow.ts` owns one persisted session and one state machine shared by
both adapters. None of these modules import React Native, so they run under
the plain TypeScript Jest config.

## Usage

```ts
import {
  createFreighterAdapter,
  createWalletConnectV2Adapter,
  createWalletConnectFlow,
} from './wallet';

const flow = createWalletConnectFlow({
  adapters: [
    createFreighterAdapter(),
    createWalletConnectV2Adapter({ connector, onSessionChange }),
  ],
  storage: AsyncStorage,
  logger,
  metrics,
});

await flow.restore();
const session = await flow.connect('freighter');
await flow.disconnect();
```

Build a QR pairing link for WalletConnect v2 with
`buildPairingUri({ topic, symKey, chains })` and validate incoming links with
`isValidPairingUri(uri)`.

## Session shape

```ts
interface WalletSession {
  kind: 'freighter' | 'walletconnect-v2';
  account: { address: string; network: 'stellar' | 'evm'; chainId?: string | number };
  connectedAt: number;
  pairingTopic?: string;
}
```

Stellar addresses are validated as `G` + 55 base-32 characters; EVM addresses
as `0x` + 40 hexadecimal characters. Sessions are stored under
`@subtrackr_wallet_session` and are cleared on restore failure or disconnect.

## Errors

`WalletConnectionError` codes: `PROVIDER_UNAVAILABLE`, `USER_REJECTED`,
`INVALID_ADDRESS`, `INVALID_SESSION`, `ADAPTER_NOT_FOUND`,
`CONNECT_IN_PROGRESS`, `CONNECT_FAILED`, `DISCONNECT_FAILED`. Rejections from
the wallet (`4001`, `-32000`, rejection messages) are normalised to
`USER_REJECTED` with `retryable: false`.

## Observability

Counters use the `subtrackr.wallet.` prefix: `connected`, `connect_failed`,
`restored`, `restore_failed`, `disconnected`, `disconnect_failed`. Connect
duration is recorded as `subtrackr.wallet.connect`. Structured logs include
wallet kind, network and error codes only — never addresses or pairing keys.

## Tests

`__tests__/freighter.test.ts`, `__tests__/walletConnectV2.test.ts` and
`__tests__/connectFlow.test.ts` cover provider resolution, address validation,
pairing URI validation, both account families, session restore, rejection
mapping, concurrent connects and persistence.
