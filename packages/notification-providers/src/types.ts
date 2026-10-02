/**
 * Types shared between the SubTrackr app backend and the standalone
 * notification microservice.
 *
 * These are declared here (rather than in either consumer) so that both
 * projects can depend on them without one importing the other's sources.
 */

export type NotificationChannel = 'email' | 'push' | 'sms' | 'in_app';

export type NotificationType =
  | 'renewal_reminder'
  | 'charge_success'
  | 'charge_failed'
  | 'dunning'
  | 'trial_ending'
  | 'security_alert'
  | 'product_update'
  | 'promotion'
  | 'digest';

/**
 * Delivers a rendered message on a channel. Returns true on success.
 * Implemented per channel and injected into the notification center.
 */
export type ChannelTransport = (input: {
  userId: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  data?: Record<string, string>;
}) => Promise<boolean>;
