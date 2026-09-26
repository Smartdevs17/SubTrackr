/**
 * paymentMethod.ts
 *
 * Dedicated type re-exports and extensions for payment method management.
 * Primary types live in `types/wallet.ts`; this module exposes them through
 * a stable public surface so consumers don't need to import from wallet.ts
 * directly and avoids circular dependency problems.
 */

export {
  TokenType,
  PaymentPriority,
  PaymentMethod,
  PaymentMethodFormData,
  PaymentAttempt,
  PaymentMethodValidationResult,
  FallbackChain,
  FallbackChainValidation,
  ExpiryAlertSeverity,
  PaymentMethodExpiryAlert,
  PaymentMethodShareRole,
  PaymentMethodShare,
  PaymentMethodStats,
  PaymentMethodAnalytics,
} from './wallet';

export type {
  GasEstimate,
  TokenBalance,
  CryptoStream,
  StreamSetup,
} from './wallet';

// ── Additional UI-layer types not present in wallet.ts ──────────────────────

/**
 * Sections for the PaymentMethodManager UI screen.
 */
export type ManagerTab = 'methods' | 'chains' | 'analytics' | 'alerts';

/**
 * View state for add/edit forms in the manager UI.
 */
export interface PaymentMethodFormState {
  /** `null` means "add new"; non-null means editing an existing id. */
  editingId: string | null;
  isOpen: boolean;
}

/**
 * Props for the PaymentMethodManager screen component.
 */
export interface PaymentMethodManagerProps {
  /** Initial tab to display. Defaults to 'methods'. */
  initialTab?: ManagerTab;
  /** Called when the user navigates away from the manager. */
  onClose?: () => void;
}

/**
 * Minimal shape exposed to share/delegation UIs so they can display the
 * grantee without needing the full PaymentMethod record.
 */
export interface SharePreview {
  shareId: string;
  methodLabel: string;
  granteeId: string;
  role: import('./wallet').PaymentMethodShareRole;
  spendLimit: string | null;
  expiresAt: Date | null;
  isActive: boolean;
}
