# WebSocket Optimization

## Overview

SubTrackr uses a real-time WebSocket layer for subscription lifecycle events
(created, updated, cancelled, charged, charge_failed, renewed). This document
covers the optimization architecture implemented to meet the acceptance criteria.

---

## Architecture

```
React Native App                     Node.js Backend
┌─────────────────────────┐          ┌──────────────────────────────┐
│  RealtimeService        │          │  WebSocketServer             │
│  ─ Connection Pool      │◄────────►│  ─ Per-user connection limit │
│  ─ Heartbeat (ping/pong)│          │  ─ Per-client send queue     │
│  ─ Inbound batch buffer │          │  ─ Batch flush timer         │
│  ─ Backoff reconnect    │          │  ─ Heartbeat eviction        │
│  ─ Metrics              │          │  ─ Throughput metrics        │
└─────────┬───────────────┘          └──────────────────────────────┘
          │
          ▼
   websocketStore.ts
   (Zustand — state + metrics)
```

---

## Feature Details

### 1. Connection Pooling

**Client side** (`src/services/realtimeService.ts`):

Multiple `RealtimeService` instances with the same server URL share a single
`WebSocket` connection. The `socketPool` map ref-counts each URL:

```typescript
// Only one real WebSocket per URL, regardless of how many
// service instances call connect()
const pooled = acquireSocket(url);
// ...
releaseSocket(url, pooled); // closes socket only when refCount reaches 0
```

**Server side** (`backend/services/notification/websocket.ts`):

Per-user connection limit prevents resource exhaustion:

```typescript
const server = new WebSocketServer({ maxConnectionsPerUser: 5 });
server.connect(clientId, userId, sendFn);
// Throws if userId already has 5 active connections
```

---

### 2. Message Batching

**Server** accumulates events in a per-client `queue[]` and flushes on a timer:

```typescript
const server = new WebSocketServer({
  batchIntervalMs: 50,   // flush every 50 ms
  maxQueueSize: 100,     // drop oldest if client is too slow
});
```

When `batchIntervalMs > 0`:
- `broadcast(event)` enqueues events instead of sending immediately
- Every `batchIntervalMs` all client queues are flushed in one pass
- If a client's queue reaches `maxQueueSize`, the oldest event is dropped (head-drop)

**Client** accumulates inbound events in `inboundBatch[]` and processes on a timer:

```typescript
const service = new RealtimeService({
  batchIntervalMs: 30,        // process batches every 30 ms
  inboundBufferSize: 200,     // max buffered events
});
```

Set `batchIntervalMs: 0` on either side to restore immediate (unbatched) mode.

---

### 3. WebSocket Compression

The server transport layer should negotiate `permessage-deflate` compression
when creating the `ws.WebSocketServer`. Example configuration for the Express
integration:

```typescript
import { WebSocketServer as WsServer } from 'ws';

const wss = new WsServer({
  server: httpServer,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },    // balance CPU vs. size
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,        // reduces memory per connection
    serverNoContextTakeover: true,
    threshold: 1024,                      // only compress messages > 1 KB
  },
});
```

The client automatically negotiates compression during the WebSocket handshake
— no code changes needed on the `RealtimeService` side.

---

### 4. Connection Health Monitoring

**Server** runs a periodic heartbeat:

```typescript
const server = new WebSocketServer({
  heartbeatIntervalMs: 30_000,  // ping every 30 s
  pingTimeoutMs: 10_000,        // evict after 10 s without pong
});
// Server emits 'ping' event → transport layer sends WebSocket ping frame
// Transport layer calls server.clientPong(clientId) on pong receipt
```

**Client** sends a ping and waits for pong:

```typescript
const service = new RealtimeService({
  heartbeatIntervalMs: 25_000,  // ping every 25 s
  pongTimeoutMs: 8_000,         // reconnect if no pong in 8 s
});
```

---

### 5. Message Throughput Metrics

Server metrics are available via `getMetrics()`:

```typescript
const metrics = webSocketServer.getMetrics();
// {
//   connectedClients: 42,
//   totalConnections: 1234,
//   totalDisconnections: 1192,
//   eventsPublished: 98_765,
//   eventsDelivered: 97_800,
//   eventsDropped: 965,
//   batchesFlushed: 23_400,
//   avgBatchSize: 4.2,
//   evictedClients: 17,
//   throughputEps: 12.3,   // events per second (rolling 10 s)
// }
```

Client metrics via `realtimeService.metrics`:

```typescript
const m = realtimeService.metrics;
// {
//   state: 'connected',
//   reconnectAttempts: 0,
//   messagesReceived: 123,
//   messagesDeliveredToSubscribers: 120,
//   messagesDropped: 3,
//   batchesProcessed: 41,
//   lastConnectedAt: 1706000000000,
//   lastPingAt: 1706001500000,
//   lastPongAt: 1706001500050,
// }
```

From the React Native app, access via the Zustand store:

```typescript
import { useWebSocketMetrics } from '../store/websocketStore';

const metrics = useWebSocketMetrics();
```

---

### 6. Connection Limit per User

```typescript
const server = new WebSocketServer({ maxConnectionsPerUser: 5 });
// Attempting a 6th connection for the same userId:
server.connect('client-6', 'user-abc', sendFn);
// → throws: "Connection limit reached for user user-abc: max 5 connections"
```

The caller (transport integration) should catch this error and close the socket
with code 4029 (Too Many Connections).

---

### 7. Graceful Degradation

**Client side:**
- Exponential backoff with ±10% jitter, capped at 30 s between reconnects
- Configurable `maxReconnectAttempts` (0 = unlimited)
- `inboundBufferSize` prevents memory growth while disconnected
- `state` field in metrics reflects: `disconnected | connecting | connected | reconnecting`

**Server side:**
- Dead clients (ping timeout) are evicted automatically
- Slow clients (queue overflow) have oldest events dropped rather than OOM-ing
- `shutdown()` flushes all pending batches before closing

---

## Configuration Reference

### Server (`WebSocketServerConfig`)

| Option | Default | Description |
|--------|---------|-------------|
| `maxConnectionsPerUser` | `5` | Max simultaneous WS connections per userId |
| `batchIntervalMs` | `50` | Batch flush interval (0 = immediate) |
| `maxQueueSize` | `100` | Max events queued per client before dropping |
| `heartbeatIntervalMs` | `30 000` | How often to ping clients |
| `pingTimeoutMs` | `10 000` | Time to wait for pong before evicting |

### Client (`RealtimeConfig`)

| Option | Default | Description |
|--------|---------|-------------|
| `reconnectDelayMs` | `1 000` | Base reconnect delay (exponential backoff) |
| `maxReconnectAttempts` | `0` | Max reconnect attempts (0 = unlimited) |
| `batchIntervalMs` | `0` | Inbound batch processing interval (0 = immediate) |
| `heartbeatIntervalMs` | `25 000` | How often to send ping |
| `pongTimeoutMs` | `8 000` | Reconnect if no pong within this time |
| `inboundBufferSize` | `200` | Max events to buffer during batch interval |

---

## Quick Start (Transport Integration)

```typescript
import { WebSocketServer as WsServer } from 'ws';
import { webSocketServer } from './services/notification/websocket';

const wss = new WsServer({ server: httpServer, perMessageDeflate: true });

wss.on('connection', (socket, req) => {
  const clientId = crypto.randomUUID();
  const userId = req.headers['x-user-id'] as string ?? 'anonymous';

  try {
    webSocketServer.connect(clientId, userId, (event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
  } catch {
    socket.close(4029, 'Too many connections');
    return;
  }

  socket.on('message', (data) => {
    const msg = data.toString();
    if (msg === 'pong') webSocketServer.clientPong(clientId);
  });

  socket.on('close', () => webSocketServer.disconnect(clientId));

  // Forward heartbeat ping to transport
  webSocketServer.on('ping', ({ clientId: id }) => {
    if (id === clientId && socket.readyState === socket.OPEN) {
      socket.send('ping');
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => webSocketServer.shutdown());
```
