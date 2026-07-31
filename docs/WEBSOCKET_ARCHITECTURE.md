# SubTrackr Event-Driven WebSocket Architecture

## Overview
SubTrackr's real-time messaging system uses an event-driven architecture decoupled from HTTP transports via Redis Pub/Sub, connection pooling, and sequence-based event replay.

## Core Components

1. **`EventDrivenWsServer` (`backend/services/notification/eventDrivenWsServer.ts`)**
   - Decoupled server listening for events over Redis Pub/Sub channels (`subtrackr_ws_events`).
   - Manages connection presence, client filter matching, and event dispatch.

2. **Connection Pooling & Active Heartbeat**
   - Server runs a periodic ping/pong audit across connected client pools.
   - Stale/unresponsive sockets are automatically disconnected (`Heartbeat timeout`).

3. **Event Replay Store**
   - Every published event receives a monotonically increasing `sequenceId`.
   - Reconnecting clients supply `lastSequenceId` via `replayEventsSince()`, receiving all missed events in exact chronological sequence.

4. **Client SDK Client (`src/services/WebSocketClient.ts`)**
   - Manages automatic reconnection with exponential backoff and transparent state recovery.

5. **Load Testing Harness (`scripts/load-test-websocket.js`)**
   - Benchmark script testing connection scale up to 10,000+ virtual client sockets.
