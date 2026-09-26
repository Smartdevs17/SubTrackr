/**
 * FraudInvestigationService
 *
 * Manages the lifecycle of fraud investigation cases.  Cases are opened
 * automatically when a risk assessment returns an action of "flag" or "block",
 * and can be progressed through a standard review workflow:
 *
 *   open → review → (resolve | escalate | dismiss)
 *
 * In production each state transition would write to the database.
 * This implementation uses an in-memory store that is suitable for the
 * dev/test environment and as a specification reference for the DB layer.
 */

import { FraudCase, FraudRiskScore, FraudReviewOutcome, FraudReviewStatus } from '../../../src/types/fraud';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface InvestigationNote {
  noteId: string;
  caseId: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface InvestigationFilter {
  status?: FraudReviewStatus;
  merchantId?: string;
  subscriberId?: string;
  minRiskScore?: number;
  limit?: number;
  offset?: number;
}

export interface CaseUpdateResult {
  success: boolean;
  error?: string;
  case?: FraudCase;
}

// ── Counters ──────────────────────────────────────────────────────────────────

let caseIdCounter = 0;
let noteIdCounter = 0;

function nextCaseId(): string {
  caseIdCounter += 1;
  return `case_${Date.now()}_${caseIdCounter}`;
}

function nextNoteId(): string {
  noteIdCounter += 1;
  return `note_${Date.now()}_${noteIdCounter}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class FraudInvestigationService {
  private cases: Map<string, FraudCase> = new Map();
  private notes: Map<string, InvestigationNote[]> = new Map();

  // ── Case creation ─────────────────────────────────────────────────────────

  /**
   * Open an investigation case from a risk assessment.
   * Returns null if the assessment action is "approve" (nothing to investigate).
   */
  openCaseFromAssessment(assessment: FraudRiskScore): FraudCase | null {
    if (assessment.action === 'approve') return null;

    const now = new Date().toISOString();
    const caseId = nextCaseId();

    const fraudCase: FraudCase = {
      caseId,
      subscriptionId: assessment.subscriptionId,
      subscriberId: assessment.subscriberId,
      merchantId: assessment.merchantId,
      merchantName: assessment.merchantName,
      subscriptionName: `Subscription ${assessment.subscriptionId}`,
      riskScore: assessment.totalScore,
      action: assessment.action,
      status: assessment.action === 'block' ? 'escalated' : 'pending',
      reason: assessment.reason,
      createdAt: now,
      updatedAt: now,
      evidence: assessment.evidence,
    };

    this.cases.set(caseId, fraudCase);
    this.notes.set(caseId, []);
    return fraudCase;
  }

  /**
   * Manually create an investigation case.
   */
  createCase(params: {
    subscriptionId: string;
    subscriberId: string;
    merchantId: string;
    merchantName: string;
    subscriptionName: string;
    riskScore: number;
    reason: string;
  }): FraudCase {
    const now = new Date().toISOString();
    const caseId = nextCaseId();
    const action = params.riskScore >= 80 ? 'block' : 'flag';

    const fraudCase: FraudCase = {
      caseId,
      subscriptionId: params.subscriptionId,
      subscriberId: params.subscriberId,
      merchantId: params.merchantId,
      merchantName: params.merchantName,
      subscriptionName: params.subscriptionName,
      riskScore: params.riskScore,
      action,
      status: action === 'block' ? 'escalated' : 'pending',
      reason: params.reason,
      createdAt: now,
      updatedAt: now,
    };

    this.cases.set(caseId, fraudCase);
    this.notes.set(caseId, []);
    return fraudCase;
  }

  // ── Case retrieval ─────────────────────────────────────────────────────────

  getCase(caseId: string): FraudCase | null {
    return this.cases.get(caseId) ?? null;
  }

  getCases(filter?: InvestigationFilter): { cases: FraudCase[]; total: number } {
    let results = Array.from(this.cases.values());

    if (filter?.status) {
      results = results.filter((c) => c.status === filter.status);
    }
    if (filter?.merchantId) {
      results = results.filter((c) => c.merchantId === filter.merchantId);
    }
    if (filter?.subscriberId) {
      results = results.filter((c) => c.subscriberId === filter.subscriberId);
    }
    if (filter?.minRiskScore !== undefined) {
      results = results.filter((c) => c.riskScore >= (filter.minRiskScore ?? 0));
    }

    // Sort by risk score descending, then by creation date descending
    results.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = results.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    const page = results.slice(offset, offset + limit);

    return { cases: page, total };
  }

  getOpenCases(): FraudCase[] {
    return this.getCases({ status: 'pending' }).cases;
  }

  getEscalatedCases(): FraudCase[] {
    return this.getCases({ status: 'escalated' }).cases;
  }

  // ── Case state transitions ─────────────────────────────────────────────────

  assignReviewer(caseId: string, reviewer: string): CaseUpdateResult {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return { success: false, error: `Case ${caseId} not found` };

    fraudCase.reviewer = reviewer;
    fraudCase.updatedAt = new Date().toISOString();
    this.cases.set(caseId, fraudCase);
    return { success: true, case: fraudCase };
  }

  startReview(caseId: string, reviewer: string): CaseUpdateResult {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return { success: false, error: `Case ${caseId} not found` };
    if (fraudCase.status === 'reviewed') {
      return { success: false, error: 'Case has already been reviewed' };
    }

    fraudCase.status = 'pending';
    fraudCase.reviewer = reviewer;
    fraudCase.updatedAt = new Date().toISOString();
    this.cases.set(caseId, fraudCase);
    return { success: true, case: fraudCase };
  }

  resolveCase(
    caseId: string,
    outcome: FraudReviewOutcome,
    notes?: string,
  ): CaseUpdateResult {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return { success: false, error: `Case ${caseId} not found` };

    const now = new Date().toISOString();
    fraudCase.status = 'reviewed';
    fraudCase.outcome = outcome;
    fraudCase.reviewedAt = now;
    fraudCase.updatedAt = now;
    if (notes) fraudCase.notes = notes;

    this.cases.set(caseId, fraudCase);
    return { success: true, case: fraudCase };
  }

  escalateCase(caseId: string, notes?: string): CaseUpdateResult {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return { success: false, error: `Case ${caseId} not found` };

    fraudCase.status = 'escalated';
    fraudCase.updatedAt = new Date().toISOString();
    if (notes) fraudCase.notes = notes;
    this.cases.set(caseId, fraudCase);
    return { success: true, case: fraudCase };
  }

  dismissCase(caseId: string, notes?: string): CaseUpdateResult {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return { success: false, error: `Case ${caseId} not found` };

    const now = new Date().toISOString();
    fraudCase.status = 'dismissed';
    fraudCase.outcome = 'false_positive';
    fraudCase.reviewedAt = now;
    fraudCase.updatedAt = now;
    if (notes) fraudCase.notes = notes;
    this.cases.set(caseId, fraudCase);
    return { success: true, case: fraudCase };
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  addNote(caseId: string, author: string, content: string): InvestigationNote | null {
    const fraudCase = this.cases.get(caseId);
    if (!fraudCase) return null;

    const note: InvestigationNote = {
      noteId: nextNoteId(),
      caseId,
      author,
      content,
      createdAt: new Date().toISOString(),
    };

    const existing = this.notes.get(caseId) ?? [];
    existing.push(note);
    this.notes.set(caseId, existing);
    return note;
  }

  getNotes(caseId: string): InvestigationNote[] {
    return this.notes.get(caseId) ?? [];
  }

  // ── Statistics ─────────────────────────────────────────────────────────────

  getStats(): {
    total: number;
    pending: number;
    escalated: number;
    reviewed: number;
    dismissed: number;
    avgRiskScore: number;
  } {
    const all = Array.from(this.cases.values());
    const total = all.length;
    const pending = all.filter((c) => c.status === 'pending').length;
    const escalated = all.filter((c) => c.status === 'escalated').length;
    const reviewed = all.filter((c) => c.status === 'reviewed').length;
    const dismissed = all.filter((c) => c.status === 'dismissed').length;
    const avgRiskScore =
      total > 0 ? Math.round(all.reduce((s, c) => s + c.riskScore, 0) / total) : 0;

    return { total, pending, escalated, reviewed, dismissed, avgRiskScore };
  }

  // ── Reset (for testing) ───────────────────────────────────────────────────

  reset(): void {
    this.cases.clear();
    this.notes.clear();
    caseIdCounter = 0;
    noteIdCounter = 0;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const fraudInvestigationService = new FraudInvestigationService();
