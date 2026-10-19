export interface ChannelProvider {
  send(
    notification: import('./notification.js').Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
