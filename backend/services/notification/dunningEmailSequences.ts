import type {
  DunningEmailVariant,
  DunningABTest,
  DunningABTestAssignment,
  DunningABTestResult,
  DunningEmailSequence,
  DunningSequenceStage,
  DunningEmailDeliveryLog,
  DunningDeliverabilityMetrics,
} from '../../../src/types/dunningABTest';
import type { DunningStage } from '../../../src/types/dunning';

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class DunningEmailSequenceService {
  private sequences = new Map<string, DunningEmailSequence>();
  private variants = new Map<string, DunningEmailVariant>();
  private abTests = new Map<string, DunningABTest>();
  private assignments = new Map<string, DunningABTestAssignment[]>();
  private deliveryLogs: DunningEmailDeliveryLog[] = [];

  // ── Email Sequence Management ───────────────────────────────────────────

  createSequence(input: {
    name: string;
    stages: Omit<DunningSequenceStage, 'fallbackVariantId'>[];
    fallbackVariantIds: Record<DunningStage, string>;
  }): DunningEmailSequence {
    const id = createId('seq');
    const ts = now();

    const stages: DunningSequenceStage[] = input.stages.map((stage) => ({
      ...stage,
      fallbackVariantId: input.fallbackVariantIds[stage.stage],
    }));

    const sequence: DunningEmailSequence = {
      id,
      name: input.name,
      stages,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    };

    this.sequences.set(id, sequence);
    return sequence;
  }

  updateSequence(id: string, updates: Partial<Pick<DunningEmailSequence, 'name' | 'stages' | 'isActive'>>): DunningEmailSequence {
    const existing = this.sequences.get(id);
    if (!existing) throw new Error(`Sequence ${id} not found`);

    const updated: DunningEmailSequence = {
      ...existing,
      ...updates,
      updatedAt: now(),
    };

    this.sequences.set(id, updated);
    return updated;
  }

  getSequence(id: string): DunningEmailSequence | undefined {
    return this.sequences.get(id);
  }

  listSequences(): DunningEmailSequence[] {
    return Array.from(this.sequences.values());
  }

  deleteSequence(id: string): void {
    this.sequences.delete(id);
  }

  getActiveSequenceForStage(stage: DunningStage): DunningEmailSequence | undefined {
    return Array.from(this.sequences.values()).find(
      (seq) => seq.isActive && seq.stages.some((s) => s.stage === stage)
    );
  }

  // ── Email Variant Management ────────────────────────────────────────────

  createVariant(input: {
    name: string;
    subject: string;
    body: string;
    stage: DunningStage;
    weight?: number;
  }): DunningEmailVariant {
    const id = createId('var');
    const ts = now();

    const variant: DunningEmailVariant = {
      id,
      name: input.name,
      subject: input.subject,
      body: input.body,
      stage: input.stage,
      weight: input.weight ?? 50,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    };

    this.variants.set(id, variant);
    return variant;
  }

  updateVariant(id: string, updates: Partial<Pick<DunningEmailVariant, 'name' | 'subject' | 'body' | 'weight' | 'isActive'>>): DunningEmailVariant {
    const existing = this.variants.get(id);
    if (!existing) throw new Error(`Variant ${id} not found`);

    const updated: DunningEmailVariant = {
      ...existing,
      ...updates,
      updatedAt: now(),
    };

    this.variants.set(id, updated);
    return updated;
  }

  getVariant(id: string): DunningEmailVariant | undefined {
    return this.variants.get(id);
  }

  listVariants(stage?: DunningStage): DunningEmailVariant[] {
    const all = Array.from(this.variants.values());
    return stage ? all.filter((v) => v.stage === stage) : all;
  }

  getActiveVariantsForStage(stage: DunningStage): DunningEmailVariant[] {
    return Array.from(this.variants.values()).filter(
      (v) => v.isActive && v.stage === stage
    );
  }

  // ── A/B Testing ─────────────────────────────────────────────────────────

  createABTest(input: {
    name: string;
    stage: DunningStage;
    variantIds: string[];
  }): DunningABTest {
    const id = createId('abt');
    const ts = now();
    const variants = input.variantIds
      .map((vid) => this.variants.get(vid))
      .filter((v): v is DunningEmailVariant => v !== undefined);

    if (variants.length < 2) {
      throw new Error('A/B test requires at least 2 variants');
    }

    const test: DunningABTest = {
      id,
      name: input.name,
      stage: input.stage,
      variants,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    };

    this.abTests.set(id, test);
    return test;
  }

  startABTest(testId: string): DunningABTest {
    const test = this.abTests.get(testId);
    if (!test) throw new Error(`A/B test ${testId} not found`);
    if (test.status !== 'draft' && test.status !== 'paused') {
      throw new Error(`Cannot start test in status ${test.status}`);
    }

    const updated: DunningABTest = {
      ...test,
      status: 'running',
      startedAt: now(),
      updatedAt: now(),
    };

    this.abTests.set(testId, updated);
    return updated;
  }

  pauseABTest(testId: string): DunningABTest {
    const test = this.abTests.get(testId);
    if (!test) throw new Error(`A/B test ${testId} not found`);

    const updated: DunningABTest = {
      ...test,
      status: 'paused',
      updatedAt: now(),
    };

    this.abTests.set(testId, updated);
    return updated;
  }

  completeABTest(testId: string, winningVariantId?: string): DunningABTest {
    const test = this.abTests.get(testId);
    if (!test) throw new Error(`A/B test ${testId} not found`);

    const results = this.getABTestResults(testId);
    const bestVariant = winningVariantId
      ?? results.sort((a, b) => b.recoveryRate - a.recoveryRate)[0]?.variantId;

    const updated: DunningABTest = {
      ...test,
      status: 'completed',
      completedAt: now(),
      winningVariantId: bestVariant,
      updatedAt: now(),
    };

    this.abTests.set(testId, updated);
    return updated;
  }

  getABTest(id: string): DunningABTest | undefined {
    return this.abTests.get(id);
  }

  listABTests(stage?: DunningStage): DunningABTest[] {
    const all = Array.from(this.abTests.values());
    return stage ? all.filter((t) => t.stage === stage) : all;
  }

  assignVariant(testId: string, subscriberId: string): DunningEmailVariant {
    const test = this.abTests.get(testId);
    if (!test || test.status !== 'running') {
      throw new Error(`A/B test ${testId} is not running`);
    }

    const existing = (this.assignments.get(testId) ?? []).find(
      (a) => a.subscriberId === subscriberId
    );
    if (existing) {
      const variant = test.variants.find((v) => v.id === existing.variantId);
      if (variant) return variant;
    }

    const totalWeight = test.variants.reduce((sum, v) => sum + v.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedVariant = test.variants[0];

    for (const variant of test.variants) {
      random -= variant.weight;
      if (random <= 0) {
        selectedVariant = variant;
        break;
      }
    }

    const assignment: DunningABTestAssignment = {
      id: createId('assign'),
      testId,
      subscriberId,
      variantId: selectedVariant.id,
      assignedAt: now(),
    };

    const assignments = this.assignments.get(testId) ?? [];
    assignments.push(assignment);
    this.assignments.set(testId, assignments);

    return selectedVariant;
  }

  getABTestResults(testId: string): DunningABTestResult[] {
    const test = this.abTests.get(testId);
    if (!test) return [];

    return test.variants.map((variant) => {
      const variantLogs = this.deliveryLogs.filter(
        (log) => log.testId === testId && log.variantId === variant.id
      );
      const sends = variantLogs.length;
      const opens = variantLogs.filter((l) => l.openedAt).length;
      const clicks = variantLogs.filter((l) => l.clickedAt).length;
      const recoveries = variantLogs.filter(
        (l) => l.status === 'clicked' || l.status === 'opened'
      ).length;

      return {
        testId,
        variantId: variant.id,
        variantName: variant.name,
        sends,
        opens,
        clicks,
        recoveries,
        openRate: sends > 0 ? opens / sends : 0,
        clickRate: sends > 0 ? clicks / sends : 0,
        recoveryRate: sends > 0 ? recoveries / sends : 0,
      };
    });
  }

  // ── Delivery Logging ────────────────────────────────────────────────────

  logDelivery(log: Omit<DunningEmailDeliveryLog, 'id' | 'sentAt'>): DunningEmailDeliveryLog {
    const entry: DunningEmailDeliveryLog = {
      ...log,
      id: createId('elog'),
      sentAt: now(),
    };

    this.deliveryLogs.push(entry);
    return entry;
  }

  updateDeliveryStatus(
    deliveryId: string,
    status: DunningEmailDeliveryLog['status'],
    metadata?: { deliveredAt?: number; openedAt?: number; clickedAt?: number; errorMessage?: string }
  ): void {
    const idx = this.deliveryLogs.findIndex((l) => l.id === deliveryId);
    if (idx === -1) return;

    this.deliveryLogs[idx] = {
      ...this.deliveryLogs[idx],
      status,
      ...metadata,
    };
  }

  getDeliveryLogs(filters?: {
    subscriberId?: string;
    subscriptionId?: string;
    stage?: DunningStage;
    testId?: string;
    limit?: number;
  }): DunningEmailDeliveryLog[] {
    let logs = [...this.deliveryLogs];

    if (filters?.subscriberId) {
      logs = logs.filter((l) => l.subscriberId === filters.subscriberId);
    }
    if (filters?.subscriptionId) {
      logs = logs.filter((l) => l.subscriptionId === filters.subscriptionId);
    }
    if (filters?.stage) {
      logs = logs.filter((l) => l.stage === filters.stage);
    }
    if (filters?.testId) {
      logs = logs.filter((l) => l.testId === filters.testId);
    }

    logs.sort((a, b) => b.sentAt - a.sentAt);

    if (filters?.limit) {
      logs = logs.slice(0, filters.limit);
    }

    return logs;
  }

  // ── Deliverability Metrics ──────────────────────────────────────────────

  getDeliverabilityMetrics(): DunningDeliverabilityMetrics {
    const logs = this.deliveryLogs;
    const totalSent = logs.length;
    const delivered = logs.filter((l) => l.status === 'delivered' || l.status === 'opened' || l.status === 'clicked').length;
    const bounced = logs.filter((l) => l.status === 'bounced').length;
    const opened = logs.filter((l) => l.openedAt).length;
    const clicked = logs.filter((l) => l.clickedAt).length;

    const stages: DunningStage[] = ['retry', 'warn', 'suspend', 'cancel'];
    const byStage: DunningDeliverabilityMetrics['byStage'] = {} as any;
    for (const stage of stages) {
      const stageLogs = logs.filter((l) => l.stage === stage);
      byStage[stage] = {
        sent: stageLogs.length,
        delivered: stageLogs.filter((l) => l.status !== 'failed' && l.status !== 'bounced').length,
        bounced: stageLogs.filter((l) => l.status === 'bounced').length,
        opened: stageLogs.filter((l) => l.openedAt).length,
        clicked: stageLogs.filter((l) => l.clickedAt).length,
      };
    }

    const variantIds = [...new Set(logs.map((l) => l.variantId))];
    const byVariant: DunningDeliverabilityMetrics['byVariant'] = {};
    for (const vid of variantIds) {
      const vLogs = logs.filter((l) => l.variantId === vid);
      const vDelivered = vLogs.filter((l) => l.status !== 'failed' && l.status !== 'bounced').length;
      const vOpened = vLogs.filter((l) => l.openedAt).length;
      const vClicked = vLogs.filter((l) => l.clickedAt).length;
      byVariant[vid] = {
        sent: vLogs.length,
        delivered: vDelivered,
        opened: vOpened,
        clicked: vClicked,
        recoveryRate: vLogs.length > 0 ? (vOpened + vClicked) / vLogs.length : 0,
      };
    }

    return {
      totalSent,
      delivered,
      bounced,
      opened,
      clicked,
      deliveryRate: totalSent > 0 ? delivered / totalSent : 0,
      bounceRate: totalSent > 0 ? bounced / totalSent : 0,
      openRate: totalSent > 0 ? opened / totalSent : 0,
      clickRate: totalSent > 0 ? clicked / totalSent : 0,
      byStage,
      byVariant,
    };
  }

  // ── Email Scheduling Optimization ───────────────────────────────────────

  getOptimalSendTime(stage: DunningStage): { hour: number; reason: string } {
    const stageLogs = this.deliveryLogs.filter((l) => l.stage === stage && l.openedAt);

    if (stageLogs.length < 10) {
      return { hour: 10, reason: 'Default: morning send for best engagement' };
    }

    const hourBuckets = new Array(24).fill(0) as number[];
    for (const log of stageLogs) {
      const hour = new Date(log.openedAt!).getHours();
      hourBuckets[hour] += 1;
    }

    const bestHour = hourBuckets.indexOf(Math.max(...hourBuckets));
    return {
      hour: bestHour,
      reason: `Data-driven: highest open rate at ${bestHour}:00 based on ${stageLogs.length} engagements`,
    };
  }

  getSequenceRecommendations(): Array<{
    type: 'timing' | 'content' | 'frequency';
    message: string;
    impact: 'high' | 'medium' | 'low';
  }> {
    const recommendations: Array<{
      type: 'timing' | 'content' | 'frequency';
      message: string;
      impact: 'high' | 'medium' | 'low';
    }> = [];

    const metrics = this.getDeliverabilityMetrics();

    if (metrics.bounceRate > 0.05) {
      recommendations.push({
        type: 'content',
        message: `Bounce rate is ${(metrics.bounceRate * 100).toFixed(1)}% (above 5% threshold). Review email list quality.`,
        impact: 'high',
      });
    }

    if (metrics.openRate < 0.2) {
      recommendations.push({
        type: 'content',
        message: `Open rate is ${(metrics.openRate * 100).toFixed(1)}%. Consider testing subject lines.`,
        impact: 'high',
      });
    }

    if (metrics.clickRate < 0.05) {
      recommendations.push({
        type: 'content',
        message: `Click rate is ${(metrics.clickRate * 100).toFixed(1)}%. Improve call-to-action placement.`,
        impact: 'medium',
      });
    }

    const runningTests = Array.from(this.abTests.values()).filter((t) => t.status === 'running');
    if (runningTests.length === 0) {
      const activeStages: DunningStage[] = ['retry', 'warn'];
      for (const stage of activeStages) {
        const variants = this.getActiveVariantsForStage(stage);
        if (variants.length >= 2) {
          recommendations.push({
            type: 'content',
            message: `No A/B test running for "${stage}" stage. You have ${variants.length} variants available.`,
            impact: 'medium',
          });
        }
      }
    }

    return recommendations;
  }
}

export const dunningEmailSequenceService = new DunningEmailSequenceService();
