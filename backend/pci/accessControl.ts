/**
 * PCI DSS — Access Control (Requirement 7 & 8)
 *
 * Role-based access control specific to payment systems. Enforces
 * least privilege, MFA, and unique user IDs for all payment operations.
 */

export type PaymentAccessRole = 'payment_admin' | 'payment_operator' | 'payment_auditor' | 'payment_support';

export interface PaymentAccessPolicy {
  role: PaymentAccessRole;
  permissions: string[];
  description: string;
  requiresMfa: boolean;
  canAccessCardData: boolean;
  canProcessRefunds: boolean;
  canViewFullPan: boolean;
}

export const PCI_ACCESS_CONTROL: Record<PaymentAccessRole, PaymentAccessPolicy> = {
  payment_admin: {
    role: 'payment_admin',
    permissions: ['payment:read', 'payment:write', 'payment:refund', 'payment:config', 'payment:audit'],
    description: 'Full payment system administration',
    requiresMfa: true,
    canAccessCardData: true,
    canProcessRefunds: true,
    canViewFullPan: false, // Even admins cannot view full PANs
  },
  payment_operator: {
    role: 'payment_operator',
    permissions: ['payment:read', 'payment:write', 'payment:refund'],
    description: 'Process payments and refunds',
    requiresMfa: true,
    canAccessCardData: true,
    canProcessRefunds: true,
    canViewFullPan: false,
  },
  payment_auditor: {
    role: 'payment_auditor',
    permissions: ['payment:read', 'payment:audit'],
    description: 'Read-only audit access to payment records',
    requiresMfa: true,
    canAccessCardData: false,
    canProcessRefunds: false,
    canViewFullPan: false,
  },
  payment_support: {
    role: 'payment_support',
    permissions: ['payment:read'],
    description: 'Support staff with read-only access (no card data)',
    requiresMfa: true,
    canAccessCardData: false,
    canProcessRefunds: false,
    canViewFullPan: false,
  },
};

export class PaymentAccessControlManager {
  private userRoles: Map<string, PaymentAccessRole> = new Map();
  private mfaEnabled: Set<string> = new Set();
  private accessLog: { userId: string; action: string; timestamp: number; allowed: boolean }[] = [];

  assignRole(userId: string, role: PaymentAccessRole): void {
    this.userRoles.set(userId, role);
  }

  revokeRole(userId: string): boolean {
    return this.userRoles.delete(userId);
  }

  getUserRole(userId: string): PaymentAccessRole | undefined {
    return this.userRoles.get(userId);
  }

  enableMfa(userId: string): void {
    this.mfaEnabled.add(userId);
  }

  isMfaEnabled(userId: string): boolean {
    return this.mfaEnabled.has(userId);
  }

  hasPermission(userId: string, permission: string): boolean {
    const role = this.userRoles.get(userId);
    if (!role) return false;
    return PCI_ACCESS_CONTROL[role].permissions.includes(permission);
  }

  /**
   * Check if user can access cardholder data.
   */
  canAccessCardData(userId: string): boolean {
    const role = this.userRoles.get(userId);
    if (!role) return false;
    const policy = PCI_ACCESS_CONTROL[role];
    return policy.canAccessCardData && this.verifyMfa(userId, role);
  }

  /**
   * Check if user can process refunds.
   */
  canProcessRefunds(userId: string): boolean {
    const role = this.userRoles.get(userId);
    if (!role) return false;
    const policy = PCI_ACCESS_CONTROL[role];
    return policy.canProcessRefunds && this.verifyMfa(userId, role);
  }

  /**
   * Check if user can view full PAN (always false per PCI DSS).
   */
  canViewFullPan(_userId: string): boolean {
    // PCI DSS Requirement 3.3: Sensitive authentication data must not be retained
    // No user should ever view full PANs
    return false;
  }

  /**
   * Verify MFA is enabled for users whose role requires it.
   */
  private verifyMfa(userId: string, role: PaymentAccessRole): boolean {
    const policy = PCI_ACCESS_CONTROL[role];
    if (policy.requiresMfa && !this.mfaEnabled.has(userId)) {
      return false;
    }
    return true;
  }

  /**
   * Log an access attempt (for PCI audit trail).
   */
  logAccess(userId: string, action: string, allowed: boolean): void {
    this.accessLog.push({ userId, action, timestamp: Date.now(), allowed });
  }

  getAccessLog(): { userId: string; action: string; timestamp: number; allowed: boolean }[] {
    return [...this.accessLog];
  }

  /**
   * Get all users with a specific role.
   */
  getUsersByRole(role: PaymentAccessRole): string[] {
    return [...this.userRoles.entries()]
      .filter(([, r]) => r === role)
      .map(([userId]) => userId);
  }
}
