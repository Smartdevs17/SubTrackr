# Biometric Step-Up for Sensitive Actions

Issue #1765 — high-risk operations require a fresh biometric check, even
though the app itself is already unlocked.

## How it works

[`src/services/auth/sensitiveActionGuard.ts`](../src/services/auth/sensitiveActionGuard.ts)
gates configured actions behind `biometricService` (which supplies the system
prompt, the device-PIN fallback, lockout backoff and failure accounting):

```ts
await sensitiveActionGuard.withBiometricGuard('transfer_funds', () =>
  transferCredit(...)
);
```

- **Enforced where configured** — a persisted policy
  (`@subtrackr/sensitive_action_policy`) lists which actions are gated.
  Defaults: `transfer_funds`, `export_private_key`, `confirm_payment`,
  `delete_account`. Actions not in the list execute without a prompt.

  ```ts
  await sensitiveActionGuard.savePolicy({
    enforced: ['transfer_funds', 'delete_account'],
    onUnavailable: 'allow',
  });
  ```

- **Graceful fallback** — when the device has no biometric hardware or no
  enrolled credentials (module missing, tests, Expo Go), the policy decides:
  `onUnavailable: 'allow'` (default) lets the user through and records
  `fellBack: true` on the result; `onUnavailable: 'block'` denies the action.
  A user who cancels the prompt gets a distinct `cancelled` result, and
  lockout after repeated failures is enforced by `biometricService` before any
  prompt is shown.

- **Deny-by-default on failure** — when a prompt is required and fails,
  `withBiometricGuard` throws `BiometricGateError` *before* the action runs;
  the operation is never executed partially.

## Wired-up actions

| Action | Call site |
| --- | --- |
| `transfer_funds` | `src/screens/SubscriptionDetailScreen.tsx` — credit transfer |
| `delete_account` | `src/screens/PrivacyCenterScreen.tsx` — GDPR deletion request |

`export_private_key` and `confirm_payment` are reserved for the wallet flows.

## Tests

`src/services/auth/__tests__/sensitiveActionGuard.test.ts` covers prompting
for enforced actions, skipping unconfigured actions, deny-on-failure,
cancellation, lockout, both fallback policies, and policy persistence/recovery
from corrupt storage.

```bash
npx jest --config jest.backend.config.js --testMatch '**/src/services/auth/__tests__/sensitiveActionGuard.test.ts'
```
