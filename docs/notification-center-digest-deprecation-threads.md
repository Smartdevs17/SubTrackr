# Notification center, digests, API deprecation reporting and Slack threads

Four additions, filed as one branch.

---

## In-app notification center (`#1250`)

`src/store/notificationCenterStore.ts` — the subscriber's inbox, the feed the
bell icon opens.

The backend already owns delivery; this store is only about *reading* the feed.
It is deliberately separate from `notificationPreferencesStore`, which answers a
different question — *where* notifications go — and is the only store the badge
reads on the hot path.

```ts
import { useNotificationCenterStore } from '../store/notificationCenterStore';

const badge = useNotificationCenterStore((s) => s.getBadge());
const sections = useNotificationCenterStore((s) => s.getSections({ unreadOnly: true }));

useNotificationCenterStore.getState().ingest(records);
useNotificationCenterStore.getState().markRead('ntf_1');
```

### Decisions

**Grouping is by day in the subscriber's timezone.** A digest summarises by UTC
because it is a server-side batch. An inbox is read on a phone, where "today" is
the reader's day, not the server's. Day keys are computed with
`Intl.DateTimeFormat` against an explicit `timeZone` rather than by shifting an
offset, because the offset depends on the instant — a subscriber in
`Australia/Sydney` is a day ahead or behind the same UTC instant twice a year.

**Dismissal is not deletion.** A dismissed entry is hidden from the feed but
still counted in analytics, so "the subscriber ignored it" stays distinguishable
from "it was never delivered". `clearDismissed()` purges them when the
subscriber asks.

**Retention drops read entries first.** `trimEntries` fills the feed with the
newest entries and only then admits unread ones, so a notification the
subscriber has not seen yet is the last thing evicted.

**Ingestion merges rather than replaces.** A fresh copy of a record from the
server must not undo a `readAt` earned on the device, so an incoming record with
no read state inherits the local one.

### API

| Export | Purpose |
| ------ | ------- |
| `toInboxEntry(record)` | Delivery record → feed entry, with derived `label`, `category`, `important` |
| `dayKeyFor(instant, timezone)` | `YYYY-MM-DD` in that zone; falls back to UTC on an invalid zone |
| `relativeDayLabel(dayKey, now, timezone)` | `Today` / `Yesterday` / absolute date |
| `isVisibleInFeed(entry, filter)` | Dismissal, type, unread, important and text filters |
| `buildSections(entries, grouping, now, timezone)` | Feed → display sections, ordered by newest |
| `buildBadge(entries, max)` | Bell badge with unread, critical and a capped label |
| `trimEntries(entries, limit)` | Retention that keeps unread entries |

Grouping is `'day' | 'type' | 'none'`.

---

## Digest emails with daily summaries (`#1251`)

`backend/services/notification/digestService.ts` — batches non-critical
notifications into one message per subscriber per day or week.

```ts
const service = createDigestEmailService({
  emailProvider,
  fromAddress: 'hello@subtrackr.app',
  preferences: (userId) => store.get(userId),
  subscribers: () => store.list(),
});

const summary = await service.run(new Date(), (userId) => historyFor(userId));
```

### Two things that are not a `groupBy`

**Critical notifications never enter a digest.** A failed payment or a security
alert is read in seconds; burying it under a morning summary means it is read in
a day or not at all.

**An empty digest is not sent.** "Nothing happened" is a notification in its own
right only if the subscriber is worried something broke, and the daily signal is
better spent on the days there is something to say.

### The window

`[start, end)` in UTC, snapped to midnight, so a run at 00:01 and a run at 23:59
cover the same day. A record is counted by the day it was *created*, not the day
it was finally delivered, and a past window can be rebuilt without shifting.

Slowing the cadence **widens** the window rather than truncating it. A subscriber
raised from daily to weekly with a last digest two days ago is owed the full
seven days, because the intermediate days were never sent to them.

### Suppressed records are reported

A `suppressed` record still describes something the subscriber chose not to be
told, so the digest says so in its footer instead of hiding the gap. `failed`
records are excluded — nothing reached the subscriber, and the failure is
already surfaced by the delivery path.

`buildFor` is pure and sends nothing, so a digest can be built and asserted
without a provider. `run` catches a per-subscriber transport failure so one bad
address cannot delay everybody else's digest.

---

## Slack threaded notification updates (`#1252`)

`backend/services/notification/slackThreads.ts` — one thread per subscription
instead of one channel message per event.

`slack.ts` posts a fresh message for every event, so a subscription that
renews, fails, retries and recovers floods the channel with four unrelated
messages. Here the first event posts to the channel and every follow-up is a
reply under it.

```ts
const notifier = new SlackThreadedNotifier({ transport, defaultChannel: '#alerts' });

await notifier.send(msg, { subscriptionId: 'sub_1', eventType: 'subscription.created' });
await notifier.send(msg, { subscriptionId: 'sub_1', eventType: 'payment.failed' });
// ^ replies under the first message
```

Threading is opt-in and additive: `send` still posts standalone messages, and a
caller that has not opted in behaves exactly as before.

### Update mode

`mode: 'update'` edits the parent instead of adding a message, for the latest
state of a subscription rather than a new event. It replaces the parent text by
default, because "processing" then "succeeded" is one status, not two. Pass
`replace: false` to append and keep the transition visible.

Update threads key on `state:<id>` rather than `sub:<id>`, so a status update
and an event thread for the same subscription stay separate.

### Slack's threading rules, encoded

- A reply carries `thread_ts` equal to the parent's timestamp.
- A thread is only indexed once the parent was actually posted, so a later event
  never tries to reply to a message Slack did not receive.
- `chat.update` needs a bot token. `createThreadTransport` reports that honestly
  instead of pretending the edit happened; use `mode: 'reply'` without a token.
- `broadcast` is not set by default, because a subscriber does not want eight
  payment retries in the channel.

`SlackThreadStore` maps a business key to a `ts`, which Slack's API does not let
us query by our own key. Losing the index costs a fresh parent, never a lost
message.

---

## API version deprecation reporting (`#1249`)

`backend/services/shared/apiDeprecationReport.ts` — reporting over the existing
`apiVersioning.ts` registry.

`apiVersioning.ts` knows how to *serve* a version: resolve it, attach
`Deprecation` and `Sunset` headers, refuse a sunset version. It had no way to
*report* on the fleet, which is what a team needs before a deprecation ships:
which versions still take traffic, how long each has left, and which are
dangerously close.

```ts
const report = buildDeprecationReport(versionRegistry, { now: new Date() });

console.log(formatReportTable(report));
console.log(formatFindings(report));
if (!isHealthy(report)) process.exitCode = 1;
```

Because the report is built from the same registry the middleware uses, what it
prints is what the server enforces. It is a pure function over the registry
stats plus an injected `now` — no I/O, no ambient clock — which is what makes it
safe to assert in CI.

### Severity

| Severity | Meaning |
| -------- | ------- |
| `ok` | Active, or deprecated with a distant sunset and no traffic |
| `warning` | Inside the 90-day window, or still receiving traffic |
| `critical` | Inside the 30-day window |
| `overdue` | The sunset date has passed but the version is still registered |
| `sunset` | Already sunset |

A sunset version is always `sunset`, never `overdue`: it is a fact about the
version rather than a risk, and folding it into `overdue` would double-count a
date already reported.

The three exported thresholds are `SUNSET_WARNING_DAYS` (90) and
`SUNSET_CRITICAL_DAYS` (30).

### What it surfaces

- `needsMigration` — deprecated versions still taking traffic.
- `stillServingSunset` — sunset versions still receiving requests. The middleware
  is answering 410s a client keeps generating; a support burden, not a bug.
- `idle` — registered versions that received no traffic at all.
- `nextSunsetAt` / `daysUntilNextSunset` — the nearest date still in the future,
  so a passed date is not reported as the next thing coming.

`toJson` flattens the migration and sunset lists to version strings, because a CI
consumer almost always wants the list rather than the whole row.
