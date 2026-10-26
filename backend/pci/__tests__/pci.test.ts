import { CardDataHandler, PCI_TOKEN_VAULT } from '../cardDataHandler';
import { NetworkSecurityService, PCI_NETWORK_SECURITY_CONTROLS } from '../networkSecurity';
import { PaymentAccessControlManager, PCI_ACCESS_CONTROL, type PaymentAccessRole } from '../accessControl';
import { PaymentMonitoringService, PCI_MONITORING_CONTROLS } from '../monitoring';
import { PCIComplianceReport } from '../pciReport';

describe('PCI DSS Card Data Handler', () => {
  let handler: CardDataHandler;

  beforeEach(() => {
    PCI_TOKEN_VAULT.clear();
    handler = new CardDataHandler();
  });

  it('should tokenize valid card data', () => {
    const result = handler.tokenize({
      pan: '4111111111111111', // Valid Visa test number
      holderName: 'John Doe',
      expiry: '12/28',
      cvv: '123',
    });
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.token?.token).toMatch(/^tok_/);
    expect(result.token?.last4).toBe('1111');
    expect(result.token?.cardBrand).toBe('visa');
    expect(result.token?.fingerprint).toBeDefined();
  });

  it('should reject invalid card numbers (Luhn)', () => {
    const result = handler.tokenize({
      pan: '4111111111111112', // Fails Luhn
      holderName: 'John Doe',
      expiry: '12/28',
      cvv: '123',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Luhn');
  });

  it('should reject invalid CVV length', () => {
    const result = handler.tokenize({
      pan: '4111111111111111',
      holderName: 'John Doe',
      expiry: '12/28',
      cvv: '12',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('CVV');
  });

  it('should detokenize and return the original PAN', () => {
    const tokenizeResult = handler.tokenize({
      pan: '4111111111111111',
      holderName: 'John Doe',
      expiry: '12/28',
      cvv: '123',
    });
    expect(tokenizeResult.success).toBe(true);
    const token = tokenizeResult.token!.token;
    const detokenizeResult = handler.detokenize(token);
    expect(detokenizeResult.success).toBe(true);
    expect(detokenizeResult.pan).toBe('4111111111111111');
  });

  it('should fail detokenization for unknown token', () => {
    const result = handler.detokenize('tok_nonexistent');
    expect(result.success).toBe(false);
  });

  it('should delete tokens', () => {
    const result = handler.tokenize({
      pan: '4111111111111111',
      holderName: 'John Doe',
      expiry: '12/28',
      cvv: '123',
    });
    const token = result.token!.token;
    expect(handler.tokenExists(token)).toBe(true);
    expect(handler.deleteToken(token)).toBe(true);
    expect(handler.tokenExists(token)).toBe(false);
  });

  it('should mask PANs for display', () => {
    expect(handler.maskPan('4111111111111111')).toBe('411111******1111');
    expect(handler.maskPan('123')).toBe('****');
  });

  it('should detect card brands', () => {
    expect(handler.tokenize({ pan: '4111111111111111', holderName: 'Test', expiry: '12/28', cvv: '123' }).token?.cardBrand).toBe('visa');
    expect(handler.tokenize({ pan: '5555555555554444', holderName: 'Test', expiry: '12/28', cvv: '123' }).token?.cardBrand).toBe('mastercard');
    expect(handler.tokenize({ pan: '378282246310005', holderName: 'Test', expiry: '12/28', cvv: '1234' }).token?.cardBrand).toBe('amex');
  });
});

describe('PCI DSS Network Security', () => {
  let service: NetworkSecurityService;

  beforeEach(() => {
    service = new NetworkSecurityService();
  });

  it('should define CDE isolation rules', () => {
    expect(PCI_NETWORK_SECURITY_CONTROLS.length).toBeGreaterThanOrEqual(5);
    const cdeRules = PCI_NETWORK_SECURITY_CONTROLS.filter(
      (r) => r.sourceZone === 'cde' || r.destZone === 'cde',
    );
    expect(cdeRules.length).toBeGreaterThanOrEqual(3);
  });

  it('should allow DMZ to CDE on port 443', () => {
    const result = service.isConnectionAllowed('dmz', 'cde', 443);
    expect(result.allowed).toBe(true);
  });

  it('should block DMZ to CDE on non-HTTPS ports', () => {
    const result = service.isConnectionAllowed('dmz', 'cde', 8080);
    expect(result.allowed).toBe(false);
  });

  it('should block public access to CDE', () => {
    const result = service.isConnectionAllowed('public', 'cde', 443);
    expect(result.allowed).toBe(false);
  });

  it('should block internal access to CDE', () => {
    const result = service.isConnectionAllowed('internal', 'cde', 443);
    expect(result.allowed).toBe(false);
  });

  it('should verify CDE isolation compliance', () => {
    const check = service.verifyCdeIsolation();
    expect(check.compliant).toBe(true);
    expect(check.disabledRules).toEqual([]);
  });

  it('should detect non-compliance when rules are disabled', () => {
    service.disableRule('cde-block-public');
    const check = service.verifyCdeIsolation();
    expect(check.compliant).toBe(false);
    expect(check.disabledRules).toContain('cde-block-public');
  });
});

describe('PCI DSS Access Control', () => {
  let manager: PaymentAccessControlManager;

  beforeEach(() => {
    manager = new PaymentAccessControlManager();
  });

  it('should define policies for all payment roles', () => {
    const roles: PaymentAccessRole[] = ['payment_admin', 'payment_operator', 'payment_auditor', 'payment_support'];
    for (const role of roles) {
      expect(PCI_ACCESS_CONTROL[role]).toBeDefined();
      expect(PCI_ACCESS_CONTROL[role].requiresMfa).toBe(true);
    }
  });

  it('should enforce MFA for payment access', () => {
    manager.assignRole('user-1', 'payment_operator');
    expect(manager.canAccessCardData('user-1')).toBe(false); // No MFA
    manager.enableMfa('user-1');
    expect(manager.canAccessCardData('user-1')).toBe(true);
  });

  it('should deny card data access for auditor role', () => {
    manager.assignRole('user-2', 'payment_auditor');
    manager.enableMfa('user-2');
    expect(manager.canAccessCardData('user-2')).toBe(false);
  });

  it('should never allow full PAN viewing', () => {
    manager.assignRole('admin-1', 'payment_admin');
    manager.enableMfa('admin-1');
    expect(manager.canViewFullPan('admin-1')).toBe(false);
  });

  it('should check refund permissions', () => {
    manager.assignRole('user-1', 'payment_operator');
    manager.enableMfa('user-1');
    expect(manager.canProcessRefunds('user-1')).toBe(true);

    manager.assignRole('user-2', 'payment_auditor');
    manager.enableMfa('user-2');
    expect(manager.canProcessRefunds('user-2')).toBe(false);
  });

  it('should log access attempts', () => {
    manager.logAccess('user-1', 'payment.charge', true);
    manager.logAccess('user-2', 'payment.refund', false);
    const log = manager.getAccessLog();
    expect(log).toHaveLength(2);
    expect(log[0].allowed).toBe(true);
    expect(log[1].allowed).toBe(false);
  });
});

describe('PCI DSS Monitoring', () => {
  let service: PaymentMonitoringService;

  beforeEach(() => {
    service = new PaymentMonitoringService();
  });

  it('should define monitoring controls', () => {
    expect(PCI_MONITORING_CONTROLS.length).toBeGreaterThanOrEqual(5);
  });

  it('should alert on failed payment attempts', () => {
    const alerts = service.evaluateMetric('payment.failed.count', 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('should alert on unauthorized PAN access', () => {
    const alerts = service.evaluateMetric('payment.pan.unauthorized_access', 1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('should not alert within thresholds', () => {
    const alerts = service.evaluateMetric('payment.failed.count', 3);
    expect(alerts).toHaveLength(0);
  });

  it('should acknowledge alerts', () => {
    const alerts = service.evaluateMetric('payment.failed.count', 10);
    expect(service.getActiveAlerts()).toHaveLength(1);
    service.acknowledgeAlert(alerts[0].id, 'admin-1');
    expect(service.getActiveAlerts()).toHaveLength(0);
  });
});

describe('PCI DSS Compliance Report', () => {
  it('should generate a compliance report covering all 12 requirements', () => {
    const cardHandler = new CardDataHandler();
    const networkSecurity = new NetworkSecurityService();
    const accessControl = new PaymentAccessControlManager();
    const monitoring = new PaymentMonitoringService();
    const report = new PCIComplianceReport(cardHandler, networkSecurity, accessControl, monitoring);

    const result = report.generate();
    expect(result.totalRequirements).toBe(12);
    expect(result.implementedRequirements).toBe(12);
    expect(result.summary).toContain('PCI DSS');
  });
});
