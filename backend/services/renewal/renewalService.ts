// Issue 560: Contract renewal automation service

import type {
  ApprovalRole,
  ApprovalWorkflow,
  ESignatureRequest,
  NegotiationWorkspace,
  RenewalApprovalChainConfig,
  RenewalMilestone,
  RenewalMilestoneEvent,
  RenewalQuote,
  RenewalRecord,
  RenewalStatus,
  RenewalType,
  WinLossReason,
} from '../../../src/types/renewal';

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const MS_PER_DAY = 86_400_000;

const MILESTONE_DAYS: Record<RenewalMilestone, number> = {
  '90_day': 90,
  '60_day': 60,
  '30_day': 30,
  expired: 0,
};

export class RenewalService {
  private renewals = new Map<string, RenewalRecord>();
  private approvalChains = new Map<string, RenewalApprovalChainConfig>();

  // Configure approval chain per merchant
  configureApprovalChain(merchantId: string, chain: ApprovalRole[]): void {
    this.approvalChains.set(merchantId, { merchantId, chain });
  }

  // Create a renewal record for a subscription
  createRenewal(
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    contractEndDate: number,
    renewalType: RenewalType = 'auto'
  ): RenewalRecord {
    const id = createId('renewal');
    const chainConfig = this.approvalChains.get(merchantId);
    const record: RenewalRecord = {
      id,
      subscriptionId,
      subscriberId,
      merchantId,
      renewalType,
      status: 'pending',
      milestones: [],
      contractStartDate: now(),
      contractEndDate,
      createdAt: now(),
      updatedAt: now(),
    };
    if (chainConfig) {
      record.approval = {
        chain: chainConfig.chain,
        steps: chainConfig.chain.map((role) => ({ role })),
        currentStep: 0,
      };
    }
    this.renewals.set(id, record);
    return record;
  }

  // Generate a renewal quote based on current plan + escalator
  generateQuote(
    renewalId: string,
    basePlanPrice: number,
    escalatorPercent: number,
    discount = 0,
    customPrice?: number
  ): RenewalQuote {
    const renewal = this.getRenewal(renewalId);
    const escalated = basePlanPrice * (1 + escalatorPercent / 100);
    const finalPrice = customPrice ?? escalated * (1 - discount / 100);
    const quote: RenewalQuote = {
      id: createId('quote'),
      renewalId,
      basePlanPrice,
      escalatorPercent,
      discount,
      customPrice,
      finalPrice: Math.max(0, finalPrice),
      currency: 'USD',
      generatedAt: now(),
    };
    renewal.quote = quote;
    renewal.updatedAt = now();
    return quote;
  }

  // Open negotiation workspace
  openNegotiation(
    renewalId: string,
    proposedTerms: string,
    notes = ''
  ): NegotiationWorkspace {
    const renewal = this.getRenewal(renewalId);
    const workspace: NegotiationWorkspace = {
      proposedTerms,
      agreedDiscount: 0,
      notes,
    };
    renewal.negotiation = workspace;
    renewal.status = 'negotiating';
    renewal.updatedAt = now();
    return workspace;
  }

  // Freeze contract mid-negotiation
  freezeNegotiation(renewalId: string): void {
    const renewal = this.getRenewal(renewalId);
    if (!renewal.negotiation) throw new Error('No active negotiation');
    renewal.negotiation.frozenAt = now();
    renewal.status = 'frozen';
    renewal.updatedAt = now();
  }

  // Update negotiation terms
  updateNegotiation(
    renewalId: string,
    updates: Partial<NegotiationWorkspace>
  ): NegotiationWorkspace {
    const renewal = this.getRenewal(renewalId);
    if (!renewal.negotiation) throw new Error('No active negotiation');
    if (renewal.negotiation.frozenAt) throw new Error('Negotiation is frozen');
    Object.assign(renewal.negotiation, updates);
    renewal.updatedAt = now();
    return renewal.negotiation;
  }

  // Advance approval workflow one step
  approveStep(renewalId: string, approvedBy: string, notes?: string): ApprovalWorkflow {
    const renewal = this.getRenewal(renewalId);
    if (!renewal.approval) throw new Error('No approval workflow configured');
    const { steps, currentStep } = renewal.approval;
    if (currentStep >= steps.length) throw new Error('Approval already complete');

    steps[currentStep].approvedBy = approvedBy;
    steps[currentStep].approvedAt = now();
    steps[currentStep].notes = notes;

    const nextStep = currentStep + 1;
    renewal.approval.currentStep = nextStep;

    if (nextStep >= steps.length) {
      renewal.approval.completedAt = now();
      renewal.status = 'awaiting_signature';
    } else {
      renewal.status = 'awaiting_approval';
    }
    renewal.updatedAt = now();
    return renewal.approval;
  }

  // Reject at any approval step
  rejectStep(renewalId: string, rejectedBy: string, notes?: string): void {
    const renewal = this.getRenewal(renewalId);
    if (!renewal.approval) throw new Error('No approval workflow configured');
    const { steps, currentStep } = renewal.approval;
    steps[currentStep].rejected = true;
    steps[currentStep].approvedBy = rejectedBy;
    steps[currentStep].notes = notes;
    renewal.status = 'lost';
    renewal.updatedAt = now();
  }

  // Initiate e-signature
  requestESignature(
    renewalId: string,
    provider: 'docusign' | 'hellosign',
    documentUrl: string
  ): ESignatureRequest {
    const renewal = this.getRenewal(renewalId);
    const sig: ESignatureRequest = {
      provider,
      documentUrl,
      requestedAt: now(),
    };
    renewal.eSignature = sig;
    renewal.status = 'awaiting_signature';
    renewal.updatedAt = now();
    return sig;
  }

  // Record signature completion
  recordSignature(renewalId: string, signatureId: string): void {
    const renewal = this.getRenewal(renewalId);
    if (!renewal.eSignature) throw new Error('No e-signature request');
    renewal.eSignature.signedAt = now();
    renewal.eSignature.signatureId = signatureId;
    renewal.status = 'signed';
    renewal.updatedAt = now();
  }

  // Record win/loss outcome
  recordOutcome(
    renewalId: string,
    outcome: 'won' | 'lost',
    reason: WinLossReason,
    notes?: string
  ): void {
    const renewal = this.getRenewal(renewalId);
    renewal.status = outcome;
    renewal.winLossReason = reason;
    renewal.winLossNotes = notes;
    renewal.updatedAt = now();
  }

  // Record a milestone event
  recordMilestone(renewalId: string, milestone: RenewalMilestone): RenewalMilestoneEvent {
    const renewal = this.getRenewal(renewalId);
    const event: RenewalMilestoneEvent = {
      milestone,
      triggeredAt: now(),
      notificationSent: false,
    };
    renewal.milestones.push(event);
    renewal.updatedAt = now();
    return event;
  }

  markMilestoneNotified(renewalId: string, milestone: RenewalMilestone): void {
    const renewal = this.getRenewal(renewalId);
    const event = renewal.milestones.find((m) => m.milestone === milestone);
    if (event) event.notificationSent = true;
  }

  // Get upcoming milestones for a renewal
  getPendingMilestones(renewalId: string): RenewalMilestone[] {
    const renewal = this.getRenewal(renewalId);
    const daysUntilExpiry = (renewal.contractEndDate - now()) / MS_PER_DAY;
    const triggered = new Set(renewal.milestones.map((m) => m.milestone));
    return (Object.keys(MILESTONE_DAYS) as RenewalMilestone[]).filter((m) => {
      const days = MILESTONE_DAYS[m];
      return daysUntilExpiry <= days && !triggered.has(m);
    });
  }

  getRenewal(renewalId: string): RenewalRecord {
    const r = this.renewals.get(renewalId);
    if (!r) throw new Error(`Renewal ${renewalId} not found`);
    return r;
  }

  listRenewals(merchantId?: string): RenewalRecord[] {
    const all = Array.from(this.renewals.values());
    return merchantId ? all.filter((r) => r.merchantId === merchantId) : all;
  }

  // Check which auto-renewals should fire
  processAutoRenewals(): RenewalRecord[] {
    const processed: RenewalRecord[] = [];
    for (const renewal of this.renewals.values()) {
      if (renewal.renewalType === 'auto' && renewal.status === 'pending') {
        const daysLeft = (renewal.contractEndDate - now()) / MS_PER_DAY;
        if (daysLeft <= 0) {
          renewal.status = 'auto_renewed';
          renewal.updatedAt = now();
          processed.push(renewal);
        }
      }
    }
    return processed;
  }
}

export const renewalService = new RenewalService();
