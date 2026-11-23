# Device Trust and Biometric Re-authentication

SubTrackr maintains a local trusted-device registry under
`@subtrackr_trusted_devices`. Each record contains a stable device ID, display
name, platform, trust timestamp, and last-seen timestamp.

## Trust operations

- `trustCurrentDevice()` requires a successful biometric/PIN re-authentication
  before adding or refreshing the current device.
- `revokeTrustedDevice()` requires re-authentication before removing a device.
- `PersistedDeviceTrustStore.revokeAllExcept()` removes other trusted devices
  after the caller has passed re-authentication.
- Corrupt stored JSON is treated as an empty registry.

## Biometric policy

Device trust registration/revocation and session revocation are enforced as
sensitive actions in `sensitiveActionGuard`:

- `trust_device`
- `revoke_trusted_device`
- `revoke_session`
- `revoke_other_sessions`

These actions fail closed when biometric authentication is unavailable. The
existing general sensitive-action policy remains configurable for other
operations.

Lockouts, cancellations, and failed prompts deny the action without executing
the trust or session mutation.

## Session management

The Session Management screen gates individual session revocation and
`Force Logout Other Sessions` through the biometric guard. Authorization failures
are shown to the user and no session state change is executed.

## Tests

```bash
npx jest --config jest.backend.config.js --testMatch '**/src/services/auth/__tests__/{deviceTrustStore,sensitiveActionGuard}.test.ts' --runInBand
```
