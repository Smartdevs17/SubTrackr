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

## Testing

```bash
# Notification domain
npx jest -c jest.backend.config.js backend/services/notification/__tests__/notificationCenterService.test.ts

# Client store and delivery path
npx jest src/store/__tests__/notificationPreferencesStore.test.ts
```
