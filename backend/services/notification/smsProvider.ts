/**
 * Re-export shim. See ./emailProvider.ts for why this indirection exists.
 */
export {
  buildLegacySmsSender,
  buildSmsTransport,
  createSmsProviderFromEnv,
  createStubSmsProvider,
  isGsm7,
  optOutStore,
  smsProvider,
  smsSegmentCount,
  truncateSms,
  TwilioSmsProvider,
} from '@subtrackr/notification-providers';
export type { SmsMessage, SmsProvider, SmsResult, TwilioConfig } from '@subtrackr/notification-providers';
