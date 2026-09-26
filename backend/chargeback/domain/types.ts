export type ChargebackNetwork = 'visa' | 'mastercard' | 'amex';

export type ChargebackStatus =
  | 'received'
  | 'under_review'
  | 'evidence_submitted'
  | 'won'
  | 'lost'
  | 'pre_arbitration'
  | 'second_chargeback';

// Reason codes per network
export const REASON_CODES: Record<ChargebackNetwork, Record<string, string>> = {
  visa: {
    '10.1': 'EMV Liability Shift Counterfeit Fraud',
    '10.2': 'EMV Liability Shift Non-Counterfeit Fraud',
    '10.3': 'Other Fraud – Card-Present Environment',
    '10.4': 'Other Fraud – Card-Absent Environment',
    '10.5': 'Visa Fraud Monitoring Program',
    '11.1': 'Card Recovery Bulletin',
    '12.1': 'Late Presentment',
    '12.5': 'Incorrect Transaction Amount',
    '13.1': 'Merchandise/Services Not Received',
    '13.2': 'Cancelled Recurring Transaction',
    '13.3': 'Not as Described or Defective Merchandise/Services',
    '13.6': 'Credit Not Processed',
    '13.7': 'Cancelled Merchandise/Services',
  },
  mastercard: {
    '4837': 'No Cardholder Authorization',
    '4849': 'Questionable Merchant Activity',
    '4853': 'Cardholder Dispute',
    '4855': 'Goods or Services Not Provided',
    '4860': 'Credit Not Processed',
    '4863': 'Cardholder Does Not Recognize',
    '4870': 'Chip Liability Shift',
    '4871': 'Chip/PIN Liability Shift',
  },
  amex: {
    A01: 'Charge Amount Exceeds Authorization Amount',
    A02: 'No Valid Authorization',
    A08: 'Authorization Approval Expired',
    C02: 'Credit Not Processed',
    C04: 'Goods/Services Returned or Refused',
    C05: 'Goods/Services Cancelled',
    C08: 'Goods/Services Not Received or Only Partially Received',
    C14: 'Paid by Other Means',
    C18: 'No Show or CARDeposit Cancelled',
    C28: 'Cancelled Recurring Billing',
    C31: 'Goods/Services Not as Described',
    C32: 'Goods/Services Damaged or Defective',
    F10: 'Missing Imprint',
    F14: 'Missing Signature',
    F24: 'No Cardmember Authorization',
    F29: 'Card Not Present',
    F30: 'EMV Counterfeit',
    F31: 'EMV Lost/Stolen/Non-Received',
    P01: 'Unassigned Card Number',
    P03: 'Credit Processed as Charge',
    P04: 'Charge Processed as Credit',
    P05: 'Incorrect Charge Amount',
    P07: 'Late Submission',
    P08: 'Duplicate Charge',
    P22: 'Non-Matching Card Number',
    P23: 'Currency Discrepancy',
    R03: 'Insufficient Reply',
    R13: 'No Reply',
    M01: 'Chargeback Authorization',
  },
};

export const EVIDENCE_CHECKLIST: Record<string, string[]> = {
  // Not received
  '13.1': [
    'Proof of delivery with signature',
    'Tracking number and carrier confirmation',
    'Customer communication logs',
    'IP address and geolocation of order',
  ],
  '4855': [
    'Proof of delivery or service completion',
    'Customer communication logs',
    'Signed contract or order confirmation',
  ],
  C08: [
    'Proof of delivery or service completion',
    'Signed delivery confirmation',
    'Customer communication logs',
  ],
  // Cancelled recurring
  '13.2': [
    'Cancellation policy disclosed at signup',
    'Proof customer did not cancel before billing',
    'Terms and conditions accepted by customer',
    'Transaction receipts for all prior cycles',
  ],
  C28: [
    'Recurring billing terms accepted by customer',
    'Proof of service usage after alleged cancellation',
    'Cancellation policy documentation',
  ],
  // Fraud
  '10.4': [
    'AVS and CVV match confirmation',
    'IP address and device fingerprint',
    '3D Secure authentication proof',
    'Customer order history showing prior purchases',
  ],
  '4837': [
    'Signed authorization',
    '3D Secure authentication proof',
    'Customer communication confirming the purchase',
    'Device fingerprint data',
  ],
  F29: ['IP address log', 'Device fingerprint', '3D Secure authentication data'],
  // Default checklist
  default: [
    'Transaction receipt',
    'Customer communication',
    'Terms and conditions',
    'Proof of service or product delivery',
  ],
};

export interface Chargeback {
  id: string;
  transactionId: string;
  merchantId: string;
  amount: number;
  currency: string;
  network: ChargebackNetwork;
  reasonCode: string;
  status: ChargebackStatus;
  filedAt: string; // ISO date
  representmentDeadline: string; // ISO date
  evidenceItems: EvidenceItem[];
  isRefundedTransaction: boolean;
  isPreArbitration: boolean;
  isSecondChargeback: boolean;
  acquirerReferenceNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceItem {
  id: string;
  chargebackId: string;
  description: string;
  fileUrl?: string;
  autoPopulated: boolean;
  submittedAt?: string;
}

export interface ChargebackAnalytics {
  totalCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  chargebackRate: number;
  byReasonCode: Record<string, number>;
  trendByMonth: { month: string; count: number; winRate: number }[];
}
