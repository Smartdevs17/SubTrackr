# Inline support chat with ticket handoff

Issue #2009 — `mobile/src/screens/support/`

## Overview

The support surface is split into two layers:

- `supportChatController.ts` — transport-agnostic state machine (send,
  optimistic delivery, failures, persistence, handoff, metrics).
- `SupportChatWidget.tsx` — React Native presentation only. It subscribes to
  the controller and never owns conversation state.

`ticketHandoff.ts` contains the pure escalation rules, so automated handoff can
be tested and tuned independently of the UI.

## Usage

```tsx
import { createSupportChatController, SupportChatWidget } from './screens/support';

const controller = createSupportChatController({
  api: {
    sendMessage: (body, ticketId) => supportApi.postMessage(body, ticketId),
    createTicket: (request) => supportApi.createTicket(request),
  },
  storage: AsyncStorage,
  logger,
  metrics,
});

<SupportChatWidget controller={controller} title="Chat with support" />;
```

## Handoff rules

`evaluateHandoff(messages, policy)` returns a `HandoffReason` and ticket
subject when any of these hold:

| Reason | Trigger |
| --- | --- |
| `user_request` | The latest user turn asks for a human, agent or representative. |
| `negative_sentiment` | Escalation language such as chargeback or legal action. |
| `complex_topic` | Security breach, unauthorised charge, double charge. |
| `repeated_questions` | Three consecutive user turns with no agent reply. |
| `manual` | The user tapped “Talk to a person” and no other rule matched. |

Negative and complex topics create a `high` priority ticket. Each successful
handoff appends one system message containing the ticket ID and stops further
automatic handoffs for that conversation.

## State and persistence

`SupportChatState` carries `messages`, `ticket`, `status`, `error`,
`isSending` and `unreadCount`. The controller stores only messages and the
ticket under `@subtrackr_support_chat` by default; invalid saved payloads are
ignored. `reset()` clears both memory and storage.

## Observability

Counters are emitted with the `subtrackr.supportChat.` prefix:
`message_sent`, `send_failed`, `handoff_detected`, `ticket_created`,
`handoff_failed`. Structured logs contain ticket IDs and reasons only, never
message bodies.

## Tests

- `__tests__/ticketHandoff.test.ts` — phrase matching, escalation rules,
  subject generation, priority.
- `__tests__/supportChatController.test.ts` — optimistic delivery, automatic
  and manual handoff, persistence, failures, validation and reset.
