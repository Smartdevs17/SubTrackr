/**
 * Load testing simulation script for 10K+ concurrent WebSocket connections
 */
const {
  EventDrivenWsServer,
  MockRedisPubSubAdapter,
} = require('../backend/services/notification/eventDrivenWsServer');

async function runLoadTest(concurrencyTarget = 10000) {
  console.log(
    `[LoadTest] Initializing WebSocket Server with target: ${concurrencyTarget} connections...`
  );
  const pubSub = new MockRedisPubSubAdapter();
  const server = new EventDrivenWsServer(pubSub);

  const startTime = Date.now();

  for (let i = 1; i <= concurrencyTarget; i++) {
    server.registerConnection({
      clientId: `client_${i}`,
      user: { id: `user_${i}`, roles: ['user'], strategy: 'jwt' },
      lastPing: Date.now(),
      isAlive: true,
      filter: { userId: `user_${i}` },
      send: () => {},
      close: () => {},
    });
  }

  const duration = Date.now() - startTime;
  console.log(
    `[LoadTest] Successfully connected ${server.activeConnectionsCount} clients in ${duration}ms.`
  );

  const publishStart = Date.now();
  await server.publishEvent({
    type: 'subscription.created',
    subscriptionId: 'sub_load_123',
    userId: 'user_100',
    payload: { test: true },
    timestamp: Date.now(),
  });
  console.log(`[LoadTest] Broadcast event dispatched in ${Date.now() - publishStart}ms.`);
}

if (require.main === module) {
  runLoadTest(10000).catch(console.error);
}

module.exports = { runLoadTest };
