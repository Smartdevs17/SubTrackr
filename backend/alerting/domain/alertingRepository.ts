import { Pool, QueryResult } from 'pg';
import type { UsageAlert, UsageAlertConfig } from './types';

export class AlertingRepository {
  constructor(private pool: Pool) {}

  async getAlertConfig(subscriptionId: string): Promise<UsageAlertConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM usage_alert_configs WHERE subscription_id = $1`,
      [subscriptionId]
    );
    return result.rows[0] || null;
  }

  async saveAlertConfig(config: UsageAlertConfig): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_alert_configs 
       (meter_id, subscription_id, user_id, plan_limit, thresholds, channels)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (subscription_id) DO UPDATE SET
         thresholds = $5, channels = $6, updated_at = now()`,
      [
        config.meter_id,
        config.subscription_id,
        config.user_id,
        config.plan_limit,
        JSON.stringify(config.thresholds),
        JSON.stringify(config.channels),
      ]
    );
  }

  async saveAlert(alert: UsageAlert): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_alerts 
       (id, subscription_id, user_id, meter_id, threshold_level, current_usage, limit, burned_rate, projected_completion, cooldown_until, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        alert.id,
        alert.subscription_id,
        alert.user_id,
        alert.meter_id,
        alert.threshold_level,
        alert.current_usage,
        alert.limit,
        alert.burned_rate,
        alert.projected_completion,
        alert.cooldown_until,
        alert.created_at,
      ]
    );
  }

  async getLastAlerts(subscriptionId: string, limitMinutes: number = 24 * 60): Promise<UsageAlert[]> {
    const cutoff = Date.now() - limitMinutes * 60 * 1000;
    const result = await this.pool.query(
      `SELECT * FROM usage_alerts 
       WHERE subscription_id = $1 AND created_at > $2
       ORDER BY created_at DESC`,
      [subscriptionId, cutoff]
    );
    return result.rows;
  }

  async getLastAlertByLevel(
    subscriptionId: string,
    level: 50 | 75 | 90 | 100
  ): Promise<UsageAlert | null> {
    const result = await this.pool.query(
      `SELECT * FROM usage_alerts 
       WHERE subscription_id = $1 AND threshold_level = $2
       ORDER BY created_at DESC LIMIT 1`,
      [subscriptionId, level]
    );
    return result.rows[0] || null;
  }

  async getPendingOverageApprovals(userId: string): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT * FROM overage_approvals 
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async recordOverageApproval(
    subscriptionId: string,
    userId: string,
    approved: boolean
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO overage_approvals (subscription_id, user_id, approved, created_at)
       VALUES ($1, $2, $3, now())`,
      [subscriptionId, userId, approved]
    );
  }
}
