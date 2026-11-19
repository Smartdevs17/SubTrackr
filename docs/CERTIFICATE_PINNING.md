# Certificate Pinning

Issue #1764 — MITM protection for the mobile API client on untrusted networks.

The mobile client pins the API server's TLS public key (SPKI SHA-256). A
certificate that does not contain a pinned key — for example one presented by an
attacker-controlled proxy — is rejected before any request bytes are sent.

## How it works

React Native's `fetch` completes the TLS handshake in native code, so pinning is
split in two halves:

- **Policy** — [`src/services/network/certificatePinning.ts`](../src/services/network/certificatePinning.ts)
  holds the configurable pin sets, verification logic and fallback behaviour.
  `ApiClient` runs a verification step before every HTTPS request
  ([`src/services/network/apiClient.ts`](../src/services/network/apiClient.ts)).
- **Observation** — the native TLS layer (OkHttp on Android,
  `NSURLSession` on iOS, or a certificate-transparency hook) registers:

  ```ts
  globalThis.__SUBTRACKR_TLS_PEER_CERT__ = async (url: string) => ({
    spkiSha256: '<base64 SHA-256 of the certificate SPKI>',
  });
  ```

  The default provider reads the observed SPKI hash from that hook. Until the
  native half ships (or on platforms without it) the provider returns `null`
  and the configured `onUnavailable` fallback decides what happens.

## Configuration (pins are configurable)

Pins are configured at build time through environment variables, or in code via
`ApiClient({ certificatePinning: { config } })`.

| Variable | Description |
| --- | --- |
| `EXPO_PUBLIC_CERT_PIN_SETS` | JSON array of pin sets: `[{ "host": "api.example.com", "pins": ["sha256/…"], "expiresAt": "2026-06-01T00:00:00Z" }]`. `host` supports `*.example.com` wildcards. |
| `EXPO_PUBLIC_CERT_PINS` | Comma-separated shorthand; applied to the host of `EXPO_PUBLIC_API_BASE_URL`. |
| `EXPO_PUBLIC_CERT_PINNING_MODE` | `enforce` (default), `report`, or `disabled`. |
| `EXPO_PUBLIC_CERT_PIN_UNAVAILABLE` | Fallback when no peer certificate / no active pins: `allow` (default) or `block`. |

A pin is the base64 SHA-256 of the certificate's Subject Public Key Info
(SPKI), written as `sha256/<base64>` (bare base64 is accepted and normalised).

```bash
openssl x509 -in api.pem -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary | openssl base64
```

## Modes and fallback path

| Situation | `enforce` | `report` | `disabled` |
| --- | --- | --- | --- |
| Peer key matches a pin | request proceeds | request proceeds | request proceeds |
| Peer key does not match | **request aborted** (`CertificatePinningError`) | request proceeds, mismatch recorded on the span | request proceeds |
| Peer certificate unavailable, `onUnavailable: allow` | request proceeds, `unavailable` recorded | request proceeds | request proceeds |
| Peer certificate unavailable, `onUnavailable: block` | **request aborted** | request proceeds | request proceeds |
| No active pin set for the host | same as "unavailable" fallback | same | request proceeds |
| Plain HTTP (dev / E2E mock hosts) | skipped | skipped | skipped |

Verification results are always written to the client span
(`security.cert_pinning.mode`, `security.cert_pinning.status`), so a rollout in
`report` mode can be measured from trace data before switching to `enforce`.

**Recommended rollout:** ship in `report` mode → watch span attributes for
`mismatch`/`unavailable` for one release → flip to `enforce` with
`onUnavailable: allow` → optionally tighten to `block` once the native provider
is guaranteed present.

## Rotation

Pin rotation is time-boxed so an app update is never a hard cut-over:

1. **Add the new pin** alongside the old one in the same pin set (or a second
   set for the same host) and give the old pin an `expiresAt` roughly one
   release cycle in the future.
2. **Ship the app.** During the overlap window both the outgoing and incoming
   keys validate, so servers can switch certificates at any point without
   breaking older builds.
3. **Verify** from trace data that `security.cert_pinning.status` is `match`.
4. **Expire the old pin.** Once `expiresAt` passes the old pin set is ignored
   automatically (`activePinSets()` filters it) — no app release required to
   drop it.

To roll back a bad pin, ship a build with the pin removed or mode `report`.

## Tests

`src/services/network/__tests__/certificatePinning.test.ts` covers:

- pin/host normalisation helpers
- match, mismatch (`enforce` / `report` / `disabled`)
- the fallback path: peer unavailable with `allow` and `block`
- hosts without pin sets
- rotation: expired pins dropped, overlap window accepted, old pin rejected
  after expiry
- environment configuration, including invalid JSON
- `ApiClient` end-to-end: request aborted before `fetch` on mismatch,
  proceeding in report mode with span attributes, provider failure treated as
  "unavailable", and HTTP hosts skipped

```bash
npx jest --config jest.backend.config.js --testMatch '**/src/services/network/__tests__/certificatePinning.test.ts'
```
