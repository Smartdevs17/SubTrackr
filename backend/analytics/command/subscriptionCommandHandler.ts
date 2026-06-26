import { QueryClient } from '../../../backend/shared/query/queryRouter';

export interface CreateSubscriptionCommand {
  id: string;
  planId: string;
  userId: string;
  amount: number;
  currency: string;
  billingCycle: string;
  nextBillingDate: Date;
  metadata?: Record<string, unknown>;
}

export interface CancelSubscriptionCommand {
  id: string;
  userId: string;
  reason?: string;
}

export class SubscriptionCommandHandler {
  constructor(private db: QueryClient) {}

  async create(cmd: CreateSubscriptionCommand): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions
         (id, plan_id, user_id, amount, currency, billing_cycle, status, next_billing_date, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, NOW(), NOW())`,
      [
        cmd.id,
        cmd.planId,
        cmd.userId,
        cmd.amount,
        cmd.currency,
        cmd.billingCycle,
        cmd.nextBillingDate,
        cmd.metadata ? JSON.stringify(cmd.metadata) : null,
      ],
    );
  }

  async cancel(cmd: CancelSubscriptionCommand): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW(),
           cancellation_reason = $3
       WHERE id = $1 AND user_id = $2`,
      [cmd.id, cmd.userId, cmd.reason ?? null],
    );
  }
}
