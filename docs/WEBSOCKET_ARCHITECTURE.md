# SubTrackr Event-Driven WebSocket Architecture

## Overview
SubTrackr's real-time messaging system uses an event-driven architecture decoupled from HTTP transports via Redis Pub/Sub, connection pooling, and sequence-based event replay.

## Core Components

1. **`WebSocketServer` (`backend/services/notification/websocket.ts`)**
   - Uses an injectable `SubscriptionEventBus` to decouple producers from socket transports.
   - Keeps the legacy `broadcast(event)` API by publishing onto the event bus.
   - Supports local in-memory delivery by default and can be backed by Redis in production adapters.

2. **`EventDrivenWsServer` (`backend/services/notification/eventDrivenWsServer.ts`)**
   - Redis Pub/Sub compatible server for sequence-based replay and horizontal fan-out.
   - Manages connection presence, client filter matching, and event dispatch.

3. **Connection Pooling & Active Heartbeat**
   - Server runs a periodic ping/pong audit across connected client pools.
   - Stale/unresponsive sockets are automatically disconnected (`Heartbeat timeout`).

4. **Event Replay Store**
   - Every published event receives a monotonically increasing `sequenceId`.
   - Reconnecting clients supply `lastSequenceId` via `replayEventsSince()`, receiving all missed events in exact chronological sequence.

5. **Client SDK Client (`src/services/WebSocketClient.ts`)**
   - Manages automatic reconnection with exponential backoff and transparent state recovery.

6. **Load Testing Harness (`scripts/load-test-websocket.js`)**
   - Benchmark script testing connection scale up to 10,000+ virtual client sockets.

## Event Bus Usage

```ts
import {
  InMemorySubscriptionEventBus,
  WebSocketServer,
} from '../backend/services/notification/websocket';

const eventBus = new InMemorySubscriptionEventBus();
const wsServer = new WebSocketServer({ batchIntervalMs: 50 }, eventBus);

wsServer.connect('client-1', 'user-1', (event) => socket.send(JSON.stringify(event)));
eventBus.publish({
  type: 'subscription.renewed',
  subscriptionId: 'sub_1',
  userId: 'user-1',
  payload: { amount: 10 },
  timestamp: Date.now(),
});
```

The default `batchIntervalMs` is `0` to preserve immediate delivery for
existing callers. Production deployments can set a non-zero interval to batch
bursty events while retaining backpressure limits through `maxQueueSize`.

## Tests

- `backend/services/notification/__tests__/websocket.test.ts`
