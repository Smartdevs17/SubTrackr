import { z } from 'zod';

export const NotificationChannelSchema = z.enum(['email', 'push', 'sms']);

export const NotificationSchema = z.object({
  id: z.string(),
  channel: NotificationChannelSchema,
  template: z.string(),
  recipient: z.string(),
  variables: z.record(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  scheduledAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;
