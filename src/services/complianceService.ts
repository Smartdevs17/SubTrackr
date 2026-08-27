import {
  ComplianceRule,
  ComplianceCheckResult,
  ComplianceAlert,
  ComplianceAuditTrailEntry,
  ComplianceDashboardSummary,
} from '../types/compliance';
import { Subscription } from '../types/subscription';

export const DEFAULT_COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: 'rule-gdpr-consent',
    name: 'GDPR Data Subject Consent & Privacy Notice',
    description: 'Ensure subscriptions collect explicit renewal consent and provide clear data processing disclosures.',
    category: 'gdpr_privacy',
    severity: 'high',
    isEnabled: true,
    regulatoryFramework: 'EU GDPR Art. 6 & 7',
  },
  {
    id: 'rule-auto-renewal-notice',
    name: 'Mandatory Auto-Renewal Disclosure',
    description: 'Subscriptions with recurring billing must explicitly disclose recurring charges and cancellation procedures.',
    category: 'auto_renewal',
    severity: 'critical',
    isEnabled: true,
    regulatoryFramework: 'California ARL / FTC Rule',
  },
  {
    id: 'rule-cancellation-accessibility',
    name: 'Simplified One-Click Cancellation Access',
    description: 'Subscribers must be provided clear, frictionless cancellation mechanisms prior to renewal billing dates.',
    category: 'cancellation_policy',
    severity: 'high',
    isEnabled: true,
    regulatoryFramework: 'EU Consumer Rights Directive',
  },
  {
    id: 'rule-billing-transparency',
    name: 'Upfront Price & Tax Disclosure',
    description: 'Billing currency, pricing details, and interval conversions must be transparently displayed.',
    category: 'billing_disclosure',
    severity: 'medium',
    isEnabled: true,
    regulatoryFramework: 'US Restore Online Shoppers Confidence Act (ROSCA)',
  },
  {
    id: 'rule-crypto-kyc-aml',
    name: 'Crypto Stream Regulatory Compliance',
    description: 'Crypto-enabled subscriptions with continuous streaming funds must adhere to token compliance checks.',
    category: 'crypto_regulatory',
    severity: 'medium',
    isEnabled: true,
    regulatoryFramework: 'FATF Travel Rule / MiCA',
  },
];

export class ComplianceService {
  private static rules: ComplianceRule[] = [...DEFAULT_COMPLIANCE_RULES];
  private static checkResults: ComplianceCheckResult[] = [];
  private static alerts: ComplianceAlert[] = [];
  private static auditTrail: ComplianceAuditTrailEntry[] = [];

  /**
   * Run automated compliance checks across all subscriptions
   */
  public static runAutomatedChecks(subscriptions: Subscription[]): ComplianceDashboardSummary {
    const results: ComplianceCheckResult[] = [];
    const newAlerts: ComplianceAlert[] = [];
    const now = new Date();

    subscriptions.forEach((sub) => {
      this.rules.forEach((rule) => {
        if (!rule.isEnabled) return;

        let status: 'passed' | 'warning' | 'failed' = 'passed';
        let details = `Subscription ${sub.name} satisfies ${rule.name}.`;
        let remediationSteps: string | undefined;

        if (rule.category === 'auto_renewal' && sub.isActive) {
          const daysToBilling = Math.ceil(
            (new Date(sub.nextBillingDate).getTime() - now.getTime()) / (1000 * 3600 * 24)
          );
          if (daysToBilling <= 3 && !sub.notificationsEnabled) {
            status = 'failed';
            details = `Upcoming auto-renewal charge in ${daysToBilling} days without user notification enabled.`;
            remediationSteps = 'Enable renewal notification alerts or send manual billing reminder.';
          }
        } else if (rule.category === 'crypto_regulatory' && sub.isCryptoEnabled) {
          if (sub.price > 1000 && !sub.cryptoToken) {
            status = 'warning';
            details = 'High-value crypto stream lacks designated verified token standard contract.';
            remediationSteps = 'Associate a verified ERC-20 / Soroban token contract address.';
          }
        } else if (rule.category === 'cancellation_policy') {
          if (!sub.isActive && sub.chargeCount && sub.chargeCount > 5) {
            status = 'passed';
          }
        }

        const checkId = `check-${sub.id}-${rule.id}-${now.getTime()}`;
        const checkResult: ComplianceCheckResult = {
          id: checkId,
          subscriptionId: sub.id,
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          status,
          severity: rule.severity,
          details,
          remediationSteps,
          checkedAt: now.toISOString(),
        };

        results.push(checkResult);

        if (status === 'failed' || status === 'warning') {
          newAlerts.push({
            id: `alert-${checkId}`,
            checkId,
            subscriptionId: sub.id,
            title: `Compliance ${status.toUpperCase()}: ${rule.name}`,
            message: details,
            severity: rule.severity,
            isAcknowledged: false,
            createdAt: now.toISOString(),
          });
        }
      });
    });

    this.checkResults = results;
    this.alerts = [...newAlerts, ...this.alerts];

    this.logAuditEntry(
      'AUTOMATED_COMPLIANCE_RUN',
      'System Compliance Engine',
      'all_subscriptions',
      `Executed ${results.length} automated compliance checks for ${subscriptions.length} subscriptions.`
    );

    return this.getDashboardSummary();
  }

  /**
   * Get active compliance alerts
   */
  public static getAlerts(): ComplianceAlert[] {
    return this.alerts;
  }

  /**
   * Acknowledge compliance alert
   */
  public static acknowledgeAlert(alertId: string, performer = 'Compliance Officer'): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.isAcknowledged = true;
      this.logAuditEntry(
        'ALERT_ACKNOWLEDGED',
        performer,
        alertId,
        `Acknowledged alert: ${alert.title}`
      );
    }
  }

  /**
   * Get audit trail logs
   */
  public static getAuditTrail(): ComplianceAuditTrailEntry[] {
    return this.auditTrail;
  }

  /**
   * Log an audit trail entry
   */
  public static logAuditEntry(action: string, performer: string, targetId: string, details: string): void {
    this.auditTrail.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      action,
      performer,
      targetId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get summary statistics for dashboard
   */
  public static getDashboardSummary(): ComplianceDashboardSummary {
    const total = this.checkResults.length;
    const passed = this.checkResults.filter((r) => r.status === 'passed').length;
    const failed = this.checkResults.filter((r) => r.status === 'failed').length;
    const warning = this.checkResults.filter((r) => r.status === 'warning').length;
    const activeAlerts = this.alerts.filter((a) => !a.isAcknowledged).length;

    const overallComplianceScore = total > 0 ? Math.round((passed / total) * 100) : 100;

    return {
      overallComplianceScore,
      totalChecksCount: total,
      passedChecksCount: passed,
      failedChecksCount: failed,
      warningChecksCount: warning,
      activeAlertsCount: activeAlerts,
      lastRunAt: new Date().toISOString(),
    };
  }

  /**
   * Generate downloadable compliance report payload
   */
  public static generateComplianceReport(format: 'json' | 'csv' = 'json'): string {
    const summary = this.getDashboardSummary();
    if (format === 'csv') {
      const headers = 'Check ID,Subscription ID,Rule,Category,Status,Severity,Details\n';
      const rows = this.checkResults
        .map(
          (r) =>
            `"${r.id}","${r.subscriptionId}","${r.ruleName}","${r.category}","${r.status}","${r.severity}","${r.details}"`
        )
        .join('\n');
      return headers + rows;
    }

    return JSON.stringify(
      {
        summary,
        rules: this.rules,
        recentResults: this.checkResults,
        activeAlerts: this.alerts,
        auditTrail: this.auditTrail,
      },
      null,
      2
    );
  }
}
