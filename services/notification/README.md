# Notification service

Consumes notifications from RabbitMQ (`RABBITMQ_QUEUE`, default
`notification.deliver`). A declarative rule engine decides where each one goes,
and the service then delivers it through the email, push or SMS provider.

## Rules

Rules live in a JSON file referenced by `NOTIFICATION_RULES_PATH`. Without it,
each notification is delivered on its own `channel`, which was the behaviour
before rules existed. The file is validated at startup. An invalid file stops the
service from starting, so rules are never silently ignored. See
`rules.example.json`.

| Key | Meaning |
| --- | --- |
| `id` | Unique rule id; it appears in logs |
| `priority` | Higher runs first (default `0`); ties keep file order |
| `enabled` | `false` skips the rule (default `true`) |
| `when` | Condition (below) |
| `then` | Actions, applied in order |
| `stop` | Stop evaluating further rules after this one matches |

**Conditions** read dot-paths from the notification (`channel`, `priority`,
`template`, `recipient`, `variables.*`, `metadata.*`). Each condition is
evaluated against the original message:

- `{ "field": "...", "eq": value }`, `{ "field": "...", "in": [values] }`
- `{ "field": "...", "exists": true|false }`, `{ "field": "...", "matches": "regex" }`
- `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": {...} }`

**Actions**

- `{ "type": "route", "channels": ["email", "push"] }` replaces the delivery channels; a later `route` overrides an earlier one
- `{ "type": "setPriority", "priority": "high" }`
- `{ "type": "suppress", "reason": "..." }` delivers nothing and ends evaluation

Notifications may include a per-user `schedule` with an IANA `timezone`, optional
quiet-hour range, and optional weekday list (`0` = Sunday). Notifications inside
the quiet period are deferred by the rule engine until the next allowed minute.

## Delivery and failures

- Each message is validated against `NotificationSchema`. Malformed JSON and
  invalid messages are dropped (nack without requeue) instead of looping.
- A routed message is sent to every channel in parallel. If any channel fails,
  the message is requeued and retried. Channels that already succeeded can then
  receive a duplicate, which matches the at-least-once delivery the queue gives.

## Observability

Every message logs one JSON line `{"event":"notification.decision", ...}` with
`notificationId`, `matchedRules`, `channels` and `suppressedBy`. Each failed
channel logs `{"event":"notification.delivery_failed", ...}`.

## Tests

```bash
pnpm --filter @subtrackr/notification-service test
```
