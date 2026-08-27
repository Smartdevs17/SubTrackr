import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { AlertingService, NotificationService } from '../alerting/domain/alertingService';
import type { UsageAlertConfig } from '../alerting/domain/types';

export function createUsageAlertsRouter(
  pool: Pool,
  notificationService: NotificationService
): Router {
  const router = Router();

  /**
   * GET /api/usage-alerts/:subscriptionId
   * Retrieve alert configuration for a subscription
   */
  router.get('/:subscriptionId', async (req: Request, res: Response) => {
    try {
      const { subscriptionId } = req.params;

      const result = await pool.query(
        `SELECT * FROM usage_alert_configs WHERE subscription_id = $1`,
        [subscriptionId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Alert config not found' });
      }

      const config = result.rows[0];
      return res.json({
        meter_id: config.meter_id,
        subscription_id: config.subscription_id,
        user_id: config.user_id,
        plan_limit: config.plan_limit,
        thresholds: config.thresholds,
        channels: config.channels,
      });
    } catch (error) {
      console.error('Error fetching alert config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/usage-alerts/:subscriptionId
   * Update alert configuration for a subscription
   */
  router.put('/:subscriptionId', async (req: Request, res: Response) => {
    try {
      const { subscriptionId } = req.params;
      const { thresholds, channels } = req.body;

      if (!Array.isArray(thresholds) || !Array.isArray(channels)) {
        return res.status(400).json({ error: 'Invalid thresholds or channels format' });
      }

      // Validate threshold levels
      const validLevels = [50, 75, 90, 100];
      for (const t of thresholds) {
        if (!validLevels.includes(t.level) || typeof t.enabled !== 'boolean') {
          return res.status(400).json({ error: 'Invalid threshold format' });
        }
      }

      // Validate channels
      const validChannels = ['in_app', 'email', 'push', 'sms'];
      for (const c of channels) {
        if (!validChannels.includes(c)) {
          return res.status(400).json({ error: 'Invalid channel' });
        }
      }

      const result = await pool.query(
        `UPDATE usage_alert_configs 
         SET thresholds = $1, channels = $2, updated_at = now()
         WHERE subscription_id = $3
         RETURNING *`,
        [JSON.stringify(thresholds), JSON.stringify(channels), subscriptionId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Alert config not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating alert config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/usage-alerts/:subscriptionId/overage-approval
   * Record user's decision on overage billing prompt
   */
  router.post('/:subscriptionId/overage-approval', async (req: Request, res: Response) => {
    try {
      const { subscriptionId } = req.params;
      const { approved } = req.body;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'approved field is required' });
      }

      await pool.query(
        `INSERT INTO overage_approvals (subscription_id, user_id, approved, created_at)
         VALUES ($1, $2, $3, now())`,
        [subscriptionId, userId, approved]
      );

      // If approved, update billing configuration
      if (approved) {
        await pool.query(
          `UPDATE subscriptions SET allow_overage = true WHERE id = $1`,
          [subscriptionId]
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error recording overage approval:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/usage-alerts/:subscriptionId/alerts
   * Get alert history for a subscription (last 24 hours)
   */
  router.get('/:subscriptionId/alerts', async (req: Request, res: Response) => {
    try {
      const { subscriptionId } = req.params;

      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const result = await pool.query(
        `SELECT 
          id, threshold_level, current_usage, "limit", burned_rate, 
          projected_completion, created_at
         FROM usage_alerts 
         WHERE subscription_id = $1 AND created_at > $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [subscriptionId, cutoff]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
