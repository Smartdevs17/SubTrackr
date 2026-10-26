# Notification Preferences and Delivery

## Overview

Notifications used to go out without any preference management: a subscriber
either had push permission or did not. Preferences are now held **per
notification type and per channel**, delivery fans out across those channels
with fallback, and every attempt lands in a history that carries read status and
feeds engagement analytics.

| Layer      | Location                                                    | Responsibility                                    |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Types      | `src/types/notification.ts`                                  | Shared vocabulary across all layers                |
| Backend    | `backend/services/notification/notificationCenterService.ts` | Server-side preferences, delivery, history         |
| Service    | `src/services/notificationService.ts`                        | On-device delivery across channels                 |
| Store      | `src/store/notificationPreferencesStore.ts`                  | Client preferences, history, analytics, templates   |
| UI         | `src/screens/NotificationPreferencesScreen.tsx`              | Preference matrix, engagement, recent activity      |

## Channels and types

Four channels: `email`, `push`, `sms`, `in_app`.

| Type               | Category | Priority    | Required | Default channels        |
| ------------------ | -------- | ----------- | -------- | ----------------------- |
| `renewal_reminder` | billing  | informative | no       | push, email             |
| `charge_success`   | billing  | informative | no       | push, in_app            |
| `charge_failed`    | billing  | critical    | **yes**  | push, email, sms        |
| `dunning`          | billing  | critical    | **yes**  | email, push             |
| `trial_ending`     | billing  | informative | no       | push, email             |
| `security_alert`   | security | critical    | **yes**  | push, email, sms        |
| `product_update`   | product  | informative | no       | in_app                  |
| `promotion`        | marketing| marketing   | no       | email                   |
| `digest`           | product  | informative | no       | email                   |

A **required** type cannot be muted and cannot have every channel turned off — a
subscriber must stay reachable about money and account security. Turning off the
last remaining channel of a required type throws on the server and is a no-op on
the client, so the switch simply refuses to move.

## Preferences

```ts
interface TypePreference {
  type: NotificationType;
  channels: Record<NotificationChannel, boolean>;
  fallbackOrder: NotificationChannel[];  // tried in order
  muted: boolean;                        // non-required types only
}
```

Client actions:

```ts
const store = useNotificationPreferencesStore.getState();
store.setChannelPreference('renewal_reminder', 'sms', true);
store.setFallbackOrder('renewal_reminder', ['email', 'push']);
store.setMuted('promotion', true);
store.setQuietHours({ enabled: true, startHour: 22, endHour: 8 });
store.updatePreferences({ minimumPriority: 'critical' });
```

The server mirrors these as `setChannelPreference`, `setFallbackOrder`,
`setMuted`, `setQuietHours` and `setMinimumPriority` on
`NotificationCenterService`.

Category opt-ins (`billing`, `product`, `marketing`, `security`) remain the
coarse switch; a type is only delivered if its category is opted in, unless the
type is required.

## Channel resolution

`resolveChannels(preferences, type)` returns the channels to attempt, in order:

1. Nothing, if the type is muted, its category is opted out, or its priority is
   below the subscriber's `minimumPriority` — required types skip all three
   checks.
2. Otherwise the `fallbackOrder` entries that are still enabled, then any other
   enabled channel.
3. If a required type somehow has every channel disabled, its first default
   channel is used as a guaranteed route.

## Multi-channel delivery

```ts
const result = await deliverNotification({
  type: 'charge_failed',
  variables: { plan: 'Netflix', amount: '$15.99' },
  subject: 'Payment failed',
  body: 'We could not complete your renewal.',
  firstSuccessOnly: true,
});
// { delivered: ['push'], failed: [], suppressed: [], scheduled: false, records: [...] }
```

By default a notification fans out to every resolved channel.
`firstSuccessOnly` stops at the first channel that accepts, which suits recovery
flows where one successful reach is enough.

Channels are backed by transports. Push is delivered on-device through Expo;
email, SMS and in-app are handed to transports the host app registers, so
neither layer is tied to a specific provider:

```ts
registerChannelTransport('email', async ({ subject, body }) => sendEmail(subject, body));
```

A channel with no registered transport records a failure rather than silently
dropping the notification.

## Suppression versus failure

A notification the subscriber has muted, or that no channel accepts, is recorded
with `status: 'suppressed'` and a reason — never dropped silently. Analytics can
then distinguish three different outcomes:

| Status       | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `scheduled`  | Deferred, e.g. past quiet hours; not yet sent                |
| `delivered`  | A transport accepted it                                     |
| `failed`     | A transport refused, threw, or was not registered           |
| `suppressed` | Preferences stopped it before any transport was consulted   |

## Scheduling

Non-critical notifications that land inside the subscriber's quiet window are
recorded as `scheduled` for the end of the window rather than sent. Critical
notifications go out immediately, whatever the hour.

A quiet window that wraps midnight (22:00–08:00) is handled correctly: the
deferral target rolls to the next day when the window has already started.

On the server, `flushScheduled(at)` sends every scheduled notification whose time
has arrived and returns the records that went out, so a worker can report on a
drained queue.

`PushScheduleEngine` (`src/services/pushScheduleEngine.ts`) remains the
per-user, open-rate-driven delivery-window optimizer and digest batcher; the
notification center handles preference resolution, routing and history.

## Templates

A template is a subject and body with `{{variable}}` placeholders, registered per
`(type, channel)` pair so each channel can carry copy of the right length:

```ts
store.upsertTemplate({
  type: 'renewal_reminder',
  channel: 'email',
  subject: '{{plan}} renews soon',
  body: 'We will charge {{amount}} on {{date}}.',
  variables: ['plan', 'amount', 'date'],
});
```

Every upsert bumps the template's `version`. Rendering substitutes the supplied
values and reports any declared variable that had no value, leaving its
placeholder blank rather than printing `{{date}}` to a subscriber. A channel with
no template falls back to the copy passed into `deliverNotification`.

Rich-text HTML bodies are sanitized separately by
`backend/services/notification/templateService.ts`, which strips executable
markup on save.

### Versioning and rollback

A raw `upsertTemplate` overwrites the previous copy, so a bad edit is
irreversible. `NotificationTemplateVersionService` adds the missing history:
each save is an immutable version chained to the template, and a rollback
republishes an earlier snapshot as the **next** version rather than rewinding
the number.

```ts
service.saveDraft({ type, channel, subject, body, variables }); // → version N+1
service.rollback(type, channel, 2);                             // → new version, restoredFrom: 2
```

Rollback is a forward move on purpose: rewriting the version number to an old
value would let two different bodies claim the same version, so a message sent
after a rollback could not be told apart from one sent before the bad edit.
Every version number stays unique and monotonic, and `restoredFrom` records
where the content came from. A save whose content is unchanged creates no
version, so the history stays meaningful.

The same model is mirrored on the device by `notificationTemplateStore`, and
`TemplateVersionHistoryScreen` lists a template's versions with a rollback
action. The backend exposes it over HTTP:

```
GET  /api/notification-templates                                  List keys
GET  /api/notification-templates/:type/:channel                   Current version
GET  /api/notification-templates/:type/:channel/versions          Full history
POST /api/notification-templates/:type/:channel                   Save new version
POST /api/notification-templates/:type/:channel/rollback?version= Roll back
```


## History and read status

Every delivery attempt is one history record per channel. The client retains the
most recent 200 on device; the server retains 500 per subscriber.

```ts
store.getHistory({ type: 'charge_failed', unreadOnly: true, since: '2026-03-01T00:00:00Z' });
store.markRead(recordId);
store.markClicked(recordId);   // implies a read
store.markAllRead();
store.unreadCount();
```

A click implies a read, so engagement is never reported as "clicked but never
opened". Marking read twice keeps the first timestamp, so time-to-read stays
accurate.

## In-app inbox

The inbox is the feed behind the bell icon (`NotificationInboxScreen`, backed by
`notificationCenterStore`). The store persists the feed on device, so history
survives relaunches and the unread badge is accurate on first paint. Tapping an
entry marks it read and records a click; dismissing hides it from the feed
without deleting it, so analytics can still distinguish "ignored" from "never
delivered".

The server mirrors the same history over HTTP (`notificationInboxRouter`, issue
#1750) so a fresh install can sync:

```
GET  /api/notifications/history?userId=…[&type=…&channel=…&status=…&unreadOnly=1&limit=…]
GET  /api/notifications/unread-count?userId=…
POST /api/notifications/history/read-all        body: { userId }
POST /api/notifications/:id/read
POST /api/notifications/:id/click
```

A click implies a read, so engagement is never reported as "clicked but never
opened". Marking read twice keeps the first timestamp, so time-to-read stays
accurate.

## Analytics

`computeAnalytics(records)` returns, in total and partitioned by channel and by
type:

| Metric                | Meaning                                             |
| --------------------- | --------------------------------------------------- |
| `sent`                | Attempts that reached a transport                   |
| `delivered`           | Attempts a transport accepted                       |
| `failed`              | Attempts a transport refused                        |
| `suppressed`          | Attempts preferences stopped                        |
| `opened` / `clicked`  | Records with a read / click timestamp               |
| `deliveryRate`        | `delivered / (delivered + failed)`                  |
| `openRate`            | `opened / delivered`                                |
| `clickRate`           | `clicked / delivered`                               |

Plus `unreadCount`, `averageTimeToReadMs` over read notifications only, and
`bestChannel` — the channel with the highest open rate over at least one
delivery, which the settings screen surfaces as "you open Email most".

Suppressed notifications are counted but excluded from the delivery rate: they
never reached a transport, so they say nothing about deliverability.

## SMS consent

A phone number's SMS consent is a legal record, so it is kept separately from
the per-channel preference flags. `SmsConsentService` stores one current
`SmsConsent` record per number plus an append-only event log:

| Field            | Meaning                                                  |
| ---------------- | -------------------------------------------------------- |
| `status`         | `opted_in` or `opted_out`                                |
| `source`         | `web_form`, `inbound_sms`, `admin`, `import`, `api`, `system` |
| `reason`         | Free-text explanation (e.g. `inbound STOP`)              |
| `explicitOptIn`  | Latches true once a number is deliberately opted in      |
| `createdAt` / `updatedAt` | First seen / last change                        |

Recording a decision always appends an audit event, even when the status is
unchanged, so a replayed inbound STOP is still attributable. The `source`
field is the answer to "where did this consent come from" — the bare
`optOutStore` in the provider package records only *that* a number is opted
out, not *when*, *why* or *by whom*.

Opt-out is honoured in two places:

- The shared provider `optOutStore` is updated, so the low-level send path
  refuses an opted-out number even if a caller skips the ledger.
- `isOptedOut(phone)` lets higher layers check before attempting a send.

Inbound `STOP` / `START` keywords are recorded by `SmsInboundHandler` with the
message SID and the matched keyword as the reason, before the reply is sent.
Web forms and admin actions use the router:

| Route                                        | Purpose                        |
| -------------------------------------------- | ------------------------------ |
| `GET  /api/sms-consent/:phone`               | Current consent record         |
| `GET  /api/sms-consent/:phone/events`        | Consent audit trail            |
| `GET  /api/sms-consent/user/:userId`         | Records owned by a user        |
| `POST /api/sms-consent/:phone/opt-out`       | Record an opt-out              |
| `POST /api/sms-consent/:phone/opt-in`        | Record an opt-in               |

The device mirrors the ledger in `src/store/smsConsentStore.ts` and surfaces it
on the SMS Consent screen (Settings → Privacy).

## Testing

```bash
# Notification domain
npx jest -c jest.backend.config.js backend/services/notification/__tests__/notificationCenterService.test.ts
npx jest -c jest.backend.config.js backend/services/notification/__tests__/smsConsentService.test.ts
npx jest -c jest.backend.config.js backend/services/notification/__tests__/smsConsentRouter.test.ts

# Client store and delivery path
npx jest --config jest.backend.config.js --testMatch '**/src/store/__tests__/smsConsentStore.test.ts'
npx jest src/store/__tests__/notificationPreferencesStore.test.ts
```
