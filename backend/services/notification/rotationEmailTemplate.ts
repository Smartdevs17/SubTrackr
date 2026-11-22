export interface RotationEmailData {
  merchantName: string;
  keyPrefix: string;
  newKeyPreview: string;
  rotationDate: string;
  gracePeriodHours: number;
  dashboardUrl: string;
}

export function buildRotationEmailHtml(data: RotationEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f8f9fa; border-radius: 12px; padding: 32px;">
    <h2 style="color: #1a1a2e; margin-top: 0;">API Key Rotation Notification</h2>
    <p>Hello ${data.merchantName},</p>
    <p>Your API key <code>${data.keyPrefix}...</code> has been automatically rotated on <strong>${data.rotationDate}</strong>.</p>
    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px;"><strong>New Key Preview:</strong></p>
      <code style="background: #f0f0f0; padding: 8px 12px; border-radius: 4px; display: block; font-size: 14px;">${data.newKeyPreview}...</code>
    </div>
    <p>The previous key remains valid for <strong>${data.gracePeriodHours} hours</strong> (grace period).</p>
    <p>Please update your integrations before the grace period expires.</p>
    <a href="${data.dashboardUrl}" style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin-top: 16px;">View in Dashboard</a>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
    <p style="color: #666; font-size: 12px;">If you did not request this rotation, please contact support immediately.</p>
  </div>
</body>
</html>`.trim();
}

export function buildRotationEmailText(data: RotationEmailData): string {
  return [
    `API Key Rotation Notification`,
    ``,
    `Hello ${data.merchantName},`,
    ``,
    `Your API key ${data.keyPrefix}... has been automatically rotated on ${data.rotationDate}.`,
    `New key preview: ${data.newKeyPreview}...`,
    ``,
    `The previous key remains valid for ${data.gracePeriodHours} hours (grace period).`,
    `Please update your integrations before the grace period expires.`,
    ``,
    `View in Dashboard: ${data.dashboardUrl}`,
    ``,
    `If you did not request this rotation, please contact support immediately.`,
  ].join('\n');
}
