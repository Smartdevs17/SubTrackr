import { z } from 'zod';

export const NotificationChannelSchema = z.enum(['email', 'push', 'sms']);

export const UserScheduleSchema = z
  .object({
    timezone: z.string().min(1).default('UTC'),
    quietHours: z
      .object({
        start: z.number().int().min(0).max(23),
        end: z.number().int().min(0).max(23),
      })
      .optional(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  })
  .strict();

export const NotificationSchema = z.object({
  id: z.string(),
  channel: NotificationChannelSchema,
  template: z.string(),
  recipient: z.string(),
  variables: z.record(z.string(), z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  scheduledAt: z.coerce.date().optional(),
  schedule: UserScheduleSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;
