import { createDefaultFactory } from './channels/factory.js';
import {
  InvalidNotificationError,
  processNotification,
  setChannelFactory,
  setRuleEngine,
} from './consumer.js';
import { loadRuleEngine } from './rules/loader.js';

const QUEUE = process.env.RABBITMQ_QUEUE ?? 'notification.deliver';

async function main() {
  const factory = createDefaultFactory(process.env);
  setChannelFactory(factory);
  const engine = await loadRuleEngine(process.env);
  setRuleEngine(engine);

  const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';
  const amqp = await import('amqplib');
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.prefetch(10);

  console.log(`Notification service listening on queue: ${QUEUE} (${engine.size} rules)`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      await processNotification(JSON.parse(msg.content.toString()));
      channel.ack(msg);
    } catch (err) {
      console.error('Failed to process notification', err);
      // Malformed messages would fail forever; drop them instead of requeueing.
      const poison = err instanceof SyntaxError || err instanceof InvalidNotificationError;
      channel.nack(msg, false, !poison);
    }
  });

  const shutdown = async () => {
    await channel.close();
    await connection.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting notification service', err);
  process.exit(1);
});
