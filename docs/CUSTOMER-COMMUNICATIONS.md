# Customer Communications

Customer-facing communication for SubTrackr: consent, transactional email,
voice renewal reminders and two-way SMS.

| Issue | Capability | Primary module |
| ----- | ---------- | -------------- |
| [#1253](https://github.com/mbo223/SubTrackr/issues/1253) | Customer communication preferences | `backend/services/notification/communicationPreferencesService.ts` |
| [#1254](https://github.com/mbo223/SubTrackr/issues/1254) | Transactional email templates | `backend/services/notification/transactionalEmailTemplates.ts` |
| [#1255](https://github.com/mbo223/SubTrackr/issues/1255) | Voice call reminders for renewals | `backend/services/notification/voiceProvider.ts`, `voiceReminderService.ts` |
| [#1256](https://github.com/mbo223/SubTrackr/issues/1256) | SMS two-way responses | `backend/services/notification/smsInboundHandler.ts` |

All four sit on top of the existing `EmailTemplateEngine` and Twilio-based
`smsProvider`, share one preference service, and are exported from
`backend/services/notification/index.ts`.

---

## #1253 Customer communication preferences

`CommunicationPreferenceService` is the single place that answers *"may we
contact this customer, and on which channel?"*.

- **Categories** — `billing`, `product`, `marketing`, `security`, `survey`.
- **Channels** — `email`, `push`, `sms`, `voice`, `in_app`. Each category has an
  ordered fallback waterfall (`DEFAULT_WATERFALL`).
- **Required categories** — `billing` and `security` can never be fully opted
  out of; the last enabled channel cannot be disabled
  (`PreferenceViolationError`, code `REQUIRED_CATEGORY_EMPTY`).
- **Hard opt-outs** — `globalOptOuts` is a per-channel kill switch set by
  `optOutChannel` / `optInChannel` (an inbound `STOP`, a do-not-call list, an
  unsubscribe link). It survives category edits.
- **Quiet hours** — `quietHours` is timezone-aware and supports windows that
  wrap midnight (22:00 → 07:00). While active, `resolveRoutes` returns
  `deferred: true` with a `deferUntil` instant.
- **Audit trail** — every change appends a `PreferenceChangeEvent`
  (`user` / `system` / `inbound_sms` / `api` sources).

### API

```
GET  /api/communication-preferences/:userId
PUT  /api/communication-preferences/:userId
POST /api/communication-preferences/:userId/channels/:channel/opt-out
POST /api/communication-preferences/:userId/channels/:channel/opt-in
GET  /api/communication-preferences/:userId/audit
```

`PUT` accepts a partial patch:

```jsonc
{
  "categories": { "billing": { "voice": true }, "marketing": { "email": false } },
  "quietHours": { "enabled": true, "startMinute": 1320, "endMinute": 420, "timezone": "Europe/Berlin" },
  "globalOptOuts": { "sms": true }
}
```

`409` is returned when a patch would violate a required-category rule, `400`
for an unknown category, channel or malformed quiet hours.

### Usage

```ts
const route = await communicationPreferenceService.resolveRoutes(
  'user-1',
  'billing',
  { email: 'a@b.c', phone: '+15550001111' }
);
// route.channels → ['email', 'sms'] in waterfall order
// route.decisions → per-channel allow/refuse with a SuppressionReason
```

### Persistence

`CommunicationPreferenceRepository` is the seam. An in-memory implementation
ships for tests and local dev; the Postgres shape lives in
`db/migrations/008_communication_preferences.sql`
(`communication_preferences`, `communication_preference_events`).

---

## #1254 Transactional email templates

Seven system-generated templates, all on the `transactional` layout:

| Template id | Trigger |
| ----------- | ------- |
| `receipt_payment_succeeded` | `payment.succeeded` |
| `invoice_due` | `invoice.due` |
| `payment_method_updated` | `payment_method.updated` |
| `refund_issued` | `payment.refunded` |
| `subscription_renewed` | `subscription.renewed` |
| `password_reset` | `auth.password_reset` |
| `email_verification` | `auth.verify_email` |

```ts
const { subject, html, text, missingVariables } = renderTransactionalEmail(
  'receipt_payment_succeeded',
  { merchant_name, subscriber_name, subscription_name, amount, currency, paid_at, receipt_url, support_email }
);
```

`renderTransactionalEmail` is deliberately strict — a transactional email that
ships a literal `{{amount}}` is a support incident, so it throws
`TransactionalTemplateError` rather than rendering a placeholder:

- `UNKNOWN_TEMPLATE` — no such template id.
- `MISSING_VARIABLES` — a required variable is absent or empty.
- `UNRESOLVED_VARIABLES` — a placeholder is present in the template but was
  not supplied.

Each template also returns a plain-text alternative (`text`) built from its own
tag lines, for terminal and screen-reader clients.

Templates register themselves on the shared `emailTemplateEngine` at import
time, so `buildEmailTransport` can resolve them by id like any other template.

---

## #1255 Voice call reminders for renewals

`voiceProvider.ts` wraps the Twilio Calls API over plain `fetch` (no SDK, same
as `smsProvider.ts`) and falls back to a stub when credentials are absent.
`voiceReminderService.ts` owns the decision to dial.

**Gating, all enforced before a call is placed:**

1. The `voice` channel must be explicitly enabled for `billing` — it is
   **opt-in**, never on by default.
2. The customer must not be on a channel-level do-not-call list.
3. A phone number is required.
4. Calls land inside `CallingHours` (default 09:00–18:00 UTC, weekdays only).
5. One call per subscription per run — pass `alreadyCalled` to suppress repeats.
6. Outside calling hours the decision carries `callAt` for the scheduler to
   retry rather than dialling at 03:00.

```ts
const { decision, record } = await voiceReminderService.remind(
  { subscriptionId, userId, subscriptionName: 'Pro Plan', renewalDate, amount, currency },
  { userId, phoneNumber, alreadyCalled: previouslyCalled }
);
// decision.reason: 'ok' | 'not_opted_in' | 'opted_out' | 'missing_phone'
//                | 'outside_calling_hours' | 'already_called' | 'no_renewal_due'
```

Milestones are `30_day`, `7_day`, `1_day`, `expired`. The spoken script is
press-to-confirm: the customer presses 1 to keep the subscription or 2 to
discuss cancelling.

### Configuration

```bash
VOICE_FROM_NUMBER=+15017122661
VOICE_APPLICATION_SID=       # optional: serve TwiML from a TwiML app
VOICE_STATUS_CALLBACK_URL=   # optional
VOICE_ENABLED=false          # force the stub provider
```

Reuses `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`.

---

## #1256 SMS two-way responses

Inbound SMS webhooks make notifications two-way: a customer can renew, pause or
opt out by replying.

```
POST /webhooks/twilio/sms/inbound
```

Twilio authenticates with HTTP Basic on the account SID (not an HMAC
signature), so the route constant-time compares the presented SID against
`TWILIO_INBOUND_ACCOUNT_SID` and answers `401` on mismatch.

### Keywords

| Keywords | Effect |
| -------- | ------ |
| `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` | opt out of SMS, no reply sent |
| `START`, `SUBSCRIBE`, `RESUBSCRIBE` | opt back in |
| `YES`, `RENEW`, `PAY` | confirm the renewal |
| `NO`, `PAUSE`, `HOLD` | snooze reminders for 7 days |
| `STATUS`, `BALANCE` | next renewal summary |
| `HELP`, `INFO` | keyword help |
| anything else | keyword help |

An exact keyword match wins; otherwise the first word is matched, so
`"STOP please"` works. Matching is case-insensitive.

### Guarantees

- **Idempotent** — a replayed `MessageSid` is acknowledged and never
  re-executed. `sms_inbound_messages.message_sid` is `UNIQUE` in Postgres.
- **Consent-safe** — the opt-out is applied to the shared `optOutStore` *before*
  any reply is attempted, and a `STOP` never triggers a reply, because texting
  someone who just asked us to stop is the one message we must not send.
- **Never throws** — Twilio retries every non-2xx, so a customer typo must not
  turn into an infinite webhook loop. Failures are returned in the result and
  recorded in the audit trail.

### Usage

```ts
const result = await smsInboundHandler.handle({
  MessageSid: 'SM123', From: '+15550001111', To: '+15017122661', Body: 'YES',
});
// result.intent  → 'renew'
// result.handled → true
// result.audit   → { messageSid, userId, intent, keyword, handledAt, replyMessageId }
```

Domain side effects are injected so the transport stays decoupled:

```ts
new SmsInboundHandler({
  provider: smsProvider,
  preferences: communicationPreferenceService,
  lookupUserByPhone: async (phone) => db.users.findByPhone(phone)?.id ?? null,
  actions: { renew, snooze, status },
});
```

---

## Tests

```bash
npm run test:backend
```

| File | Covers |
| ---- | ------ |
| `__tests__/communicationPreferencesService.test.ts` | defaults, opt-in/out, required-category guard, quiet hours, routing, audit |
| `__tests__/transactionalEmailTemplates.test.ts` | registration, required-variable enforcement, plain text, failure paths |
| `__tests__/voiceReminderService.test.ts` | TwiML, Twilio success/error/network failures, calling hours, every skip reason |
| `__tests__/smsInboundHandler.test.ts` | parsing, keyword map, consent, idempotency, reply failure, auth guard |

Backend tests run through `jest.backend.config.js` (`npm run test:backend`).
The root `jest.config.js` ignores `backend/`, so `npm test` does not execute
them.
