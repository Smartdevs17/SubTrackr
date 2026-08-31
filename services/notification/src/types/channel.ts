export interface ChannelProvider {
  send(
    notification: import('./notification').Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
