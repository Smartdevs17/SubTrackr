/**
 * Centralized constants for SubTrackr application
 * Replaces magic numbers throughout the codebase for better maintainability
 */

// Time constants
export const TIME_CONSTANTS = {
  /** Seconds in a minute */
  SECONDS_PER_MINUTE: 60,
  /** Minutes in an hour */
  MINUTES_PER_HOUR: 60,
  /** Hours in a day */
  HOURS_PER_DAY: 24,
  /** Days in a week */
  DAYS_PER_WEEK: 7,
  /** Average days in a month (30.44) */
  DAYS_PER_MONTH: 30.44,
  /** Days in a year (365.25 accounting for leap years) */
  DAYS_PER_YEAR: 365.25,
  /** Seconds in an hour */
  SECONDS_PER_HOUR: 60 * 60,
  /** Seconds in a day */
  SECONDS_PER_DAY: 24 * 60 * 60,
  /** Seconds in a week */
  SECONDS_PER_WEEK: 7 * 24 * 60 * 60,
  /** Approximate seconds in a month (30 days) */
  SECONDS_PER_MONTH: 30 * 24 * 60 * 60,
  /** Seconds in a year */
  SECONDS_PER_YEAR: 365 * 24 * 60 * 60,
  /** Milliseconds in a second */
  MS_PER_SECOND: 1000,
  /** Milliseconds in a minute */
  MS_PER_MINUTE: 60 * 1000,
  /** Milliseconds in an hour */
  MS_PER_HOUR: 60 * 60 * 1000,
  /** Milliseconds in a day */
  MS_PER_DAY: 24 * 60 * 60 * 1000,
  /** Milliseconds in a week */
  MS_PER_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Billing cycle conversion factors
export const BILLING_CONVERSIONS = {
  /** Average weeks per month for accurate conversion */
  WEEKS_PER_MONTH: 52 / 12, // 4.333...
  /** Weeks per year */
  WEEKS_PER_YEAR: 52,
  /** Months per year */
  MONTHS_PER_YEAR: 12,
} as const;

// Cryptocurrency and blockchain constants
export const CRYPTO_CONSTANTS = {
  /** Standard ETH decimals */
  ETH_DECIMALS: 18,
  /** Standard USDC decimals */
  USDC_DECIMALS: 6,
  /** Wei to ETH conversion factor */
  WEI_TO_ETHER: 1e18,
  /** Gas limit fallback for estimation failures */
  FALLBACK_GAS_LIMIT: 100000,
  /** Gas buffer multiplier for Polygon (130%) */
  POLYGON_GAS_BUFFER_MULTIPLIER: 130,
  /** Gas buffer multiplier for other networks (120%) */
  DEFAULT_GAS_BUFFER_MULTIPLIER: 120,
} as const;

// Cache and performance constants
export const CACHE_CONSTANTS = {
  /** Cache TTL in milliseconds (1 minute) */
  CACHE_TTL_MS: 60_000,
  /** Write debounce delay in milliseconds */
  WRITE_DEBOUNCE_MS: 400,
} as const;

// Default values and limits
export const DEFAULT_VALUES = {
  /** Default currency */
  DEFAULT_CURRENCY: 'USD',
  /** Default billing cycle */
  DEFAULT_BILLING_CYCLE: 'monthly',
  /** Maximum length for text truncation */
  MAX_TEXT_LENGTH: 50,
  /** Default flow rate buffer percentage */
  FLOW_RATE_BUFFER_PERCENTAGE: 20,
} as const;

// Address constants
export const ADDRESS_CONSTANTS = {
  /** Zero address for Ethereum */
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  /** Sablier V2 LockupLinear contract address */
  SABLIER_V2_LOCKUP_LINEAR: '0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9',
} as const;

// Chain ID constants
export const CHAIN_IDS = {
  /** Ethereum Mainnet */
  ETHEREUM: 1,
  /** Polygon Mainnet */
  POLYGON: 137,
  /** Arbitrum Mainnet */
  ARBITRUM: 42161,
} as const;

// Formatting constants
export const FORMATTING_CONSTANTS = {
  /** Default address start characters */
  ADDRESS_START_CHARS: 6,
  /** Default address end characters */
  ADDRESS_END_CHARS: 4,
  /** Maximum fraction digits for compact currency */
  COMPACT_MAX_FRACTION_DIGITS: 1,
  /** Maximum fraction digits for regular currency */
  REGULAR_MAX_FRACTION_DIGITS: 2,
  /** Default crypto decimals for formatting */
  DEFAULT_CRYPTO_DECIMALS: 18,
} as const;
