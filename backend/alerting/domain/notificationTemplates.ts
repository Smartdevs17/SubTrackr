import type { UsageAlert } from './types';

export interface NotificationTemplateData {
  threshold_level: 50 | 75 | 90 | 100;
  current_usage: number;
  limit: number;
  burned_rate: number;
  projected_completion: Date;
  subscription_name: string;
  merchant_name: string;
}

export class NotificationTemplateRenderer {
  renderInAppBanner(data: NotificationTemplateData): string {
    const percentage = (data.current_usage / data.limit) * 100;
    return `You've used ${percentage.toFixed(0)}% of your ${data.subscription_name} plan limit (${data.current_usage.toLocaleString()}/${data.limit.toLocaleString()} units). Current burn rate: ${data.burned_rate.toFixed(2)} units/min.`;
  }

  renderEmailHtml(data: NotificationTemplateData): string {
    const percentage = (data.current_usage / data.limit) * 100;
    const completionTime = data.projected_completion.toLocaleString();

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 15px; border-radius: 4px; }
    .alert-level { font-weight: bold; color: ${this.getColorByLevel(data.threshold_level)}; }
    .metrics { margin: 20px 0; }
    .metric-row { display: flex; justify-content: space-between; padding: 8px 0; }
    .cta { margin-top: 20px; }
    .button { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚠️ Usage Alert: <span class="alert-level">${data.threshold_level}%</span> Threshold Reached</h2>
      <p>for <strong>${data.subscription_name}</strong> by ${data.merchant_name}</p>
    </div>
    
    <div class="metrics">
      <div class="metric-row">
        <span>Current Usage:</span>
        <strong>${data.current_usage.toLocaleString()} / ${data.limit.toLocaleString()} units</strong>
      </div>
      <div class="metric-row">
        <span>Percentage:</span>
        <strong>${percentage.toFixed(1)}%</strong>
      </div>
      <div class="metric-row">
        <span>Burn Rate:</span>
        <strong>${data.burned_rate.toFixed(2)} units/min</strong>
      </div>
      <div class="metric-row">
        <span>Projected Limit Reached:</span>
        <strong>${completionTime}</strong>
      </div>
    </div>

    <div class="cta">
      <p>To manage your plan or enable overage billing:</p>
      <a href="https://app.subtrackr.io/usage-settings" class="button">View Usage Settings</a>
    </div>
  </div>
</body>
</html>
    `;
  }

  renderPushNotification(data: NotificationTemplateData): { title: string; body: string } {
    const percentage = (data.current_usage / data.limit) * 100;
    const emoji = data.threshold_level === 100 ? '🚨' : '⚠️';
    return {
      title: `${emoji} ${data.subscription_name} Usage Alert`,
      body: `${percentage.toFixed(0)}% of plan limit reached (${data.current_usage.toLocaleString()}/${data.limit.toLocaleString()} units)`,
    };
  }

  renderSmsSms(data: NotificationTemplateData): string {
    const percentage = (data.current_usage / data.limit) * 100;
    const emoji = data.threshold_level === 100 ? '🚨' : '⚠️';
    return `${emoji} SubTrackr: ${data.subscription_name} usage at ${percentage.toFixed(0)}%. Burn rate: ${data.burned_rate.toFixed(1)} units/min. Manage: app.subtrackr.io`;
  }

  private getColorByLevel(level: 50 | 75 | 90 | 100): string {
    if (level === 50) return '#ffc107'; // amber
    if (level === 75) return '#ff9800'; // orange
    if (level === 90) return '#f44336'; // red-light
    return '#d32f2f'; // red-dark
  }
}
