import { z } from 'zod';
import { NotificationChannelSchema } from '../types/notification.js';

/**
 * Declarative notification rules.
 *
 * A rule matches a notification with a `when` condition and applies `then`
 * actions. Rules are evaluated in `priority` order (higher first, ties keep
 * file order). A rule with `stop: true` ends evaluation after it matches.
 */

/** Dot-path into the notification, e.g. `channel` or `metadata.event`. */
const FieldPath = z.string().regex(/^[A-Za-z_][\w]*(\.[\w-]+)*$/, 'invalid field path');
const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; eq: string | number | boolean }
  | { field: string; in: Array<string | number | boolean> }
  | { field: string; exists: boolean }
  | { field: string; matches: string };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ field: FieldPath, eq: Scalar }).strict(),
    z.object({ field: FieldPath, in: z.array(Scalar).min(1) }).strict(),
    z.object({ field: FieldPath, exists: z.boolean() }).strict(),
    z
      .object({
        field: FieldPath,
        matches: z.string().refine((source) => {
          try {
            new RegExp(source);
            return true;
          } catch {
            return false;
          }
        }, 'invalid regular expression'),
      })
      .strict(),
  ])
);

export const ActionSchema = z.discriminatedUnion('type', [
  /** Replace the delivery channels. Later `route` actions override earlier ones. */
  z.object({ type: z.literal('route'), channels: z.array(NotificationChannelSchema).min(1) }).strict(),
  /** Drop the notification; nothing is delivered. */
  z.object({ type: z.literal('suppress'), reason: z.string().min(1) }).strict(),
  z.object({ type: z.literal('setPriority'), priority: z.enum(['low', 'normal', 'high']) }).strict(),
]);

export const RuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
    stop: z.boolean().default(false),
    when: ConditionSchema,
    then: z.array(ActionSchema).min(1),
  })
  .strict();

export const RuleSetSchema = z
  .array(RuleSchema)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `duplicate rule id: ${rule.id}` });
      }
      seen.add(rule.id);
    });
  });

export type Action = z.infer<typeof ActionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RuleInput = z.input<typeof RuleSchema>;
