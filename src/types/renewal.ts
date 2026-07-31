// Issue 560: Contract renewal automation types

export type RenewalMilestone = '90_day' | '60_day' | '30_day' | 'expired';

export type RenewalStatus =
  | 'pending'
  | 'negotiating'
  | 'awaiting_approval'
  | 'awaiting_signature'
  | 'signed'
  | 'auto_renewed'
  | 'won'
  | 'lost'
  | 'frozen';

export type ApprovalRole = 'sales_manager' | 'finance' | 'legal';

export type RenewalType = 'auto' | 'opt_in';

export type WinLossReason =
  | 'price_too_high'
  | 'competitor'
  | 'budget_cut'
  | 'scope_change'
  | 'accepted_offer'
  | 'custom_terms_agreed'
  | 'other';

export interface RenewalMilestoneEvent {
  milestone: RenewalMilestone;
  triggeredAt: number;
  notificationSent: boolean;
}

export interface RenewalQuote {
  id: string;
  renewalId: string;
  basePlanPrice: number;
  escalatorPercent: number;
  discount: number;
  customPrice?: number;
  finalPrice: number;
  currency: string;
  generatedAt: number;
  terms?: string;
}

export interface ApprovalStep {
  role: ApprovalRole;
  approvedBy?: string;
  approvedAt?: number;
  rejected?: boolean;
  notes?: string;
}

export interface ApprovalWorkflow {
  chain: ApprovalRole[];
  steps: ApprovalStep[];
  currentStep: number;
  completedAt?: number;
}

export interface ESignatureRequest {
  provider: 'docusign' | 'hellosign';
  documentUrl: string;
  requestedAt: number;
  signedAt?: number;
  signatureId?: string;
}

export interface NegotiationWorkspace {
  proposedTerms: string;
  counterTerms?: string;
  agreedDiscount: number;
  customPricing?: number;
  frozenAt?: number; // mid-negotiation contract freeze
  notes: string;
}

export interface RenewalRecord {
  id: string;
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  renewalType: RenewalType;
  status: RenewalStatus;
  milestones: RenewalMilestoneEvent[];
  quote?: RenewalQuote;
  negotiation?: NegotiationWorkspace;
  approval?: ApprovalWorkflow;
  eSignature?: ESignatureRequest;
  winLossReason?: WinLossReason;
  winLossNotes?: string;
  contractStartDate: number;
  contractEndDate: number;
  createdAt: number;
  updatedAt: number;
}

export interface RenewalApprovalChainConfig {
  merchantId: string;
  chain: ApprovalRole[];
}
