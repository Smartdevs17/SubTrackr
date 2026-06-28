import * as amqp from 'amqplib';
import { z } from 'zod';
import { Notification } from '../../services/notification/src/types/notification';

const NotificationSchema = z.object({
  id: z.string(),
  channel: z.enum(['email', 'push', 'sms']),
  template: z.string(),
  recipient: z.string(),
  variables: z.record(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  scheduledAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type NotificationMessage = z.infer<typeof NotificationSchema>;

export class NotificationProducer {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly queue = 'notification.deliver';

  async connect(url?: string) {
    this.connection = await amqp.connect(url ?? 'amqp://localhost');
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(this.queue, { durable: true });
  }

  async publish(notification: Notification): Promise<void> {
    if (!this.channel) throw new Error('NotificationProducer not connected');
    const payload = NotificationSchema.parse(notification);
    this.channel.sendToQueue(this.queue, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
