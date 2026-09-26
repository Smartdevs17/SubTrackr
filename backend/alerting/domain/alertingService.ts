import { Pool } from 'pg';
import type { MeterUsageSnapshot, UsageAlertConfig, UsageAlert } from './types';
import { ThresholdEvaluator } from './thresholdEvaluator';
import { AlertingRepository } from './alertingRepository';
import { NotificationTemplateRenderer } from './notificationTemplates';

export interface NotificationService {
  sendInAppBanner(userId: string, message: string): Promise<void>;
  sendEmail(userId: string, subscriptionId: string, htmlContent: string): Promise<void>;
  sendPush(userId: string, title: string, body: string): Promise<void>;
  sendSms(userId: string, message: string): Promise<void>;
}

export class AlertingService {
  private evaluator = new ThresholdEvaluator();
  private renderer = new NotificationTemplateRenderer();
  private repository: AlertingRepository;

  constructor(
    private pool: Pool,
    private notificationService: NotificationService
  ) {
    this.repository = new AlertingRepository(pool);
  }

  /**
   * Main evaluation loop: runs every 5 minutes.
   * Evaluates all subscriptions with alerting enabled.
   */
  async evaluateAllThresholds(): Promise<void> {
    const configs = await this.pool.query(
      `SELECT * FROM usage_alert_configs WHERE enabled = true`
    );

    for (const config of configs.rows) {
      await this.evaluateSubscription(config);
    }
  }

  private async evaluateSubscription(config: UsageAlertConfig): Promise<void> {
    try {
      // Get current usage snapshot
      const snapshot = await this.getUsageSnapshot(config);
      if (!snapshot) return;

      // Get recent alerts for cooldown check
      const lastAlerts = await this.repository.getLastAlerts(config.subscription_id);
      const lastAlertsMap = new Map(lastAlerts.map((a) => [`${a.meter_id}::${a.threshold_level}`, a]));

      // Check for threshold crossing
      const result = this.evaluator.shouldSendAlert(snapshot, config, lastAlertsMap);
      if (!result) return;

      const { alert, threshold } = result;

      // Save alert to database
      await this.repository.saveAlert(alert);

      // Get subscription & merchant info for template
      const subInfo = await this.getSubscriptionInfo(config.subscription_id);
      if (!subInfo) return;

      const templateData = {
        threshold_level: alert.threshold_level,
        current_usage: alert.current_usage,
        limit: alert.limit,
        burned_rate: alert.burned_rate,
        projected_completion: new Date(alert.projected_completion),
        subscription_name: subInfo.name,
        merchant_name: subInfo.merchant_name,
      };

      // Send notifications on enabled channels
      for (const channel of config.channels) {
        await this.sendNotification(channel, config, templateData);
      }

      // If 100% threshold, also alert merchant admin
      if (threshold.level === 100) {
        await this.notificationService.sendEmail(
          subInfo.merchant_admin_email,
          config.subscription_id,
          this.renderer.renderEmailHtml({
            ...templateData,
            subscription_name: `${templateData.subscription_name} (${config.user_id})`,
          })
        );
      }
    } catch (error) {
      console.error(`Error evaluating subscription ${config.subscription_id}:`, error);
    }
  }

  private async sendNotification(
    channel: 'in_app' | 'email' | 'push' | 'sms',
    config: UsageAlertConfig,
    templateData: any
  ): Promise<void> {
    switch (channel) {
      case 'in_app':
        await this.notificationService.sendInAppBanner(
          config.user_id,
          this.renderer.renderInAppBanner(templateData)
        );
        break;
      case 'email':
        await this.notificationService.sendEmail(
          config.user_id,
          config.subscription_id,
          this.renderer.renderEmailHtml(templateData)
        );
        break;
      case 'push':
        const push = this.renderer.renderPushNotification(templateData);
        await this.notificationService.sendPush(config.user_id, push.title, push.body);
        break;
      case 'sms':
        await this.notificationService.sendSms(config.user_id, this.renderer.renderSmsSms(templateData));
        break;
    }
  }

  private async getUsageSnapshot(config: UsageAlertConfig): Promise<MeterUsageSnapshot | null> {
    const result = await this.pool.query(
      `SELECT 
        meter_id, subscription_id, user_id, 
        current_usage, plan_limit, 
        billing_period_start, billing_period_end,
        ROUND((current_usage::float / plan_limit) * 100, 2) as usage_percentage
       FROM usage_metrics 
       WHERE subscription_id = $1 AND meter_id = $2`,
      [config.subscription_id, config.meter_id]
    );
    return result.rows[0] || null;
  }

  private async getSubscriptionInfo(subscriptionId: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT s.name, u.email as merchant_admin_email, u.name as merchant_name
       FROM subscriptions s
       JOIN users u ON s.merchant_id = u.id
       WHERE s.id = $1`,
      [subscriptionId]
    );
    return result.rows[0] || null;
  }

  async updateAlertConfig(subscriptionId: string, config: Partial<UsageAlertConfig>): Promise<void> {
    const existing = await this.repository.getAlertConfig(subscriptionId);
    if (!existing) throw new Error(`Alert config not found for ${subscriptionId}`);

    const merged = { ...existing, ...config };
    await this.repository.saveAlertConfig(merged);
  }

  async recordOverageApproval(subscriptionId: string, userId: string, approved: boolean): Promise<void> {
    await this.repository.recordOverageApproval(subscriptionId, userId, approved);
  }
}
