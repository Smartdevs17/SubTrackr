import { Pool } from 'pg';
import * as Expo from 'expo-server-sdk';
import type { NotificationService } from '../alerting/domain/alertingService';

export class NotificationServiceImpl implements NotificationService {
  private expoClient: Expo.Expo;

  constructor(private pool: Pool) {
    this.expoClient = new Expo.Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    });
  }

  async sendInAppBanner(userId: string, message: string): Promise<void> {
    // Store in-app notification in database
    await this.pool.query(
      `INSERT INTO notifications (user_id, type, message, created_at)
       VALUES ($1, 'in_app', $2, now())`,
      [userId, message]
    );
  }

  async sendEmail(userId: string, subscriptionId: string, htmlContent: string): Promise<void> {
    // Get user email
    const result = await this.pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (!result.rows[0]) return;

    const email = result.rows[0].email;

    // Queue email for delivery (using your existing email service)
    await this.pool.query(
      `INSERT INTO email_queue (recipient, subject, html_body, created_at)
       VALUES ($1, $2, $3, now())`,
      [email, 'Usage Alert - SubTrackr', htmlContent]
    );
  }

  async sendPush(userId: string, title: string, body: string): Promise<void> {
    // Get user push tokens from Expo
    const result = await this.pool.query(
      `SELECT expo_push_token FROM user_devices WHERE user_id = $1 AND expo_push_token IS NOT NULL`,
      [userId]
    );

    if (result.rows.length === 0) return;

    const tokens = result.rows.map((r: any) => r.expo_push_token).filter(Expo.isExpoPushToken);

    if (tokens.length === 0) return;

    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: { type: 'usage_alert' },
    }));

    try {
      const tickets = await this.expoClient.sendPushNotificationsAsync(messages);
      console.log('[NotificationService] Expo push tickets:', tickets);
    } catch (error) {
      console.error('[NotificationService] Failed to send push:', error);
    }
  }

  async sendSms(userId: string, message: string): Promise<void> {
    // Get user phone number
    const result = await this.pool.query(`SELECT phone FROM users WHERE id = $1`, [userId]);
    if (!result.rows[0]?.phone) return;

    const phone = result.rows[0].phone;

    // Queue SMS for delivery (using your SMS provider, e.g., Twilio)
    await this.pool.query(
      `INSERT INTO sms_queue (recipient_phone, message, created_at)
       VALUES ($1, $2, now())`,
      [phone, message]
    );
  }
}
