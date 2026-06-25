import { ChannelFactory, createDefaultFactory } from './channels/factory';
import { processNotification } from './consumer';

const QUEUE = process.env.RABBITMQ_QUEUE ?? 'notification.deliver';

async function main() {
  const factory = createDefaultFactory(process.env);
  setChannelFactory(factory);

  const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';
  const amqp = await import('amqplib');
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.prefetch(10);

  const server = Bun ? { listen: (port: number) => console.log(`Listening on ${port}`) } : {};

  console.log(`Notification service listening on queue: ${QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const notification = JSON.parse(msg.content.toString()) as import('./types/notification').Notification;
      await processNotification(notification);
      channel.ack(msg);
    } catch (err) {
      console.error('Failed to process notification', err);
      channel.nack(msg, false, true);
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
