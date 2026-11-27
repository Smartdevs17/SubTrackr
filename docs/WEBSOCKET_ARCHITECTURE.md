# SubTrackr Event-Driven WebSocket Architecture

## Overview

The real-time messaging layer separates event production from WebSocket connections. The default event adapter is in-memory for local development and tests. Multi-process deployments can use Redis Pub/Sub to fan events out to every backend instance.

## Core Components

1. **`WebSocketServer` (`backend/services/notification/websocket.ts`)**
   - Uses an injectable `SubscriptionEventBus` to decouple producers from socket transports.
   - Preserves the `broadcast(event)` API and local in-memory delivery.
   - Supports batching, backpressure, heartbeat checks, and delivery metrics.

2. **`EventDrivenWsServer` (`backend/services/notification/eventDrivenWsServer.ts`)**
   - Manages local socket connections, filters, presence, event sequencing, and replay.
   - Subscribes to the shared `subtrackr_ws_events` channel before accepting published events.
   - Exposes `ready` so startup can wait for the Redis subscription to be active.
   - `shutdown()` stops heartbeats, removes local connections, and closes its Pub/Sub adapter.

3. **Redis Pub/Sub adapter (`backend/services/notification/redisPubSubAdapter.ts`)**
   - `IORedisPubSubAdapter` uses separate publisher and subscriber connections, as Redis subscriber connections cannot be used for normal commands.
   - A single Redis subscription fans messages out to local handlers registered for that channel.
   - `createRedisPubSubAdapter()` creates and health-checks both connections using the shared `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `REDIS_DB` configuration.
   - The adapter owns both connections and closes them during shutdown.

## Production setup

Create one adapter per backend process and inject it into the event-driven server:

```ts
import { EventDrivenWsServer } from '../backend/services/notification/eventDrivenWsServer';
import { createRedisPubSubAdapter } from '../backend/services/notification/redisPubSubAdapter';

const pubSub = await createRedisPubSubAdapter();
const wsServer = new EventDrivenWsServer(pubSub);

// Do not accept socket connections until the shared channel is subscribed.
await wsServer.ready;

// During graceful process shutdown:
await wsServer.shutdown();
```

All backend instances must use the same Redis deployment, database, and channel. Each instance receives published events and dispatches them only to its own matching local connections. Redis Pub/Sub is at-most-once delivery: events published while a subscriber is disconnected are not buffered by Redis. Use the event store/replay mechanism when durable recovery is required.

For local development and isolated unit tests, omit the adapter or inject `MockRedisPubSubAdapter` to avoid a Redis dependency.

## Event replay

Each event published through an `EventDrivenWsServer` receives a monotonically increasing sequence identifier and is retained in a bounded in-process replay buffer. A reconnecting client can pass its last seen sequence to `replayEventsSince()`. This buffer is local to the server process; it is not a durable, cluster-wide event log.

## Tests

- `backend/services/notification/__tests__/websocket.test.ts`
- `backend/services/notification/__tests__/redisPubSubAdapter.test.ts`
- `backend/services/notification/__tests__/eventDrivenWsServer.test.ts`
