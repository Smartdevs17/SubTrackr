# PCI DSS Compliance for Payment Handling

## Overview

Implements PCI DSS controls for secure cardholder data handling through
tokenization, network segmentation, access control, and monitoring.

## Key Components

### Card Data Handler (Requirement 3)
- Tokenization of card PANs using AES-256-GCM encryption
- Luhn validation on card numbers
- CVV is never stored — used transiently only
- Card brand detection (Visa, Mastercard, Amex, Discover, JCB)
- PAN masking for display (first 6 + last 4)
- Token vault for secure PAN storage

### Network Security (Requirement 1)
- CDE (Cardholder Data Environment) network isolation
- Default-deny firewall rules
- Only HTTPS (port 443) allowed to/from CDE
- CDE isolation compliance verification

### Access Control (Requirements 7 & 8)
- 4 payment-specific roles with least-privilege
- MFA required for all payment system access
- No user can ever view full PANs (PCI DSS 3.3)
- Access logging for audit trail

### Monitoring (Requirement 10)
- 6 monitoring controls for payment events
- Failed payment attempt tracking
- Unauthorized PAN access detection
- Detokenization frequency monitoring
- Refund volume anomaly detection

## Usage

```typescript
import { CardDataHandler, NetworkSecurityService, PaymentAccessControlManager, PaymentMonitoringService, PCIComplianceReport } from './pci';

// Tokenize a card
const handler = new CardDataHandler();
const result = handler.tokenize({ pan: '4111111111111111', holderName: 'John', expiry: '12/28', cvv: '123' });

// Generate compliance report
const report = new PCIComplianceReport(handler, new NetworkSecurityService(), new PaymentAccessControlManager(), new PaymentMonitoringService());
console.log(report.generate());
```
