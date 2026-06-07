import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { useSupportStore } from '../store';
import { SupportTicket, TicketIssueType } from '../types/support';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

const issueTypeLabels: Record<TicketIssueType, string> = {
  failed_charge: 'Failed charge',
  cancellation: 'Cancellation',
  dispute: 'Dispute',
  general: 'General',
};

const statusColors: Record<SupportTicket['status'], string> = {
  open: colors.warning,
  assigned: colors.primary,
  pending_customer: colors.accent,
  resolved: colors.success,
  closed: colors.textSecondary,
};

const SupportDashboardScreen: React.FC = () => {
  const { width } = useWindowDimensions();
  const isWide = width >= 1024;
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const {
    tickets,
    integration,
    createTicket,
    assignTicket,
    updateTicketStatus,
    performSupportAction,
    syncTicket,
    linkResolution,
    submitSurvey,
    setIntegration,
  } = useSupportStore();

  useEffect(() => {
    if (!selectedTicketId && tickets.length > 0) {
      setSelectedTicketId(tickets[0].id);
    }
  }, [selectedTicketId, tickets]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0] ?? null,
    [selectedTicketId, tickets]
  );

  const metrics = useMemo(() => {
    const open = tickets.filter((ticket) => ticket.status === 'open').length;
    const assigned = tickets.filter((ticket) => ticket.status === 'assigned').length;
    const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length;
    const breached = tickets.filter((ticket) => ticket.sla.breached).length;
    const synced = tickets.filter((ticket) => Boolean(ticket.externalTicketId)).length;
    const surveysCompleted = tickets.filter(
      (ticket) => ticket.survey.status === 'completed'
    ).length;

    return { open, assigned, resolved, breached, synced, surveysCompleted };
  }, [tickets]);

  const createSampleTicket = (issueType: TicketIssueType) => {
    const sequence = tickets.length + 1;
    const createdAt = new Date();
    const context = {
      subscriptionName: issueType === 'cancellation' ? 'Atlas Team' : 'Nova Studio',
      planName: issueType === 'cancellation' ? 'Enterprise' : 'Pro',
      planTier: issueType === 'cancellation' ? 'enterprise' : 'premium',
      billingCycle: 'monthly',
      status: issueType === 'cancellation' ? 'cancel_pending' : 'active',
      amount: issueType === 'cancellation' ? 149 : 49,
      currency: 'USD',
      createdAt: new Date('2026-05-01T10:00:00.000Z').toISOString(),
      nextBillingDate: new Date('2026-06-01T10:00:00.000Z').toISOString(),
      failedPayments: issueType === 'failed_charge' ? 2 : 0,
      chargeCount: issueType === 'failed_charge' ? 4 : 1,
      history:
        issueType === 'failed_charge'
          ? [
              'Two failed payment retries in the last 24 hours',
              'Customer complained about card declines',
            ]
          : ['Cancellation requested via app', 'Customer asked for invoice history'],
    };

    const ticket = createTicket({
      subscriptionId: `sub_support_${sequence}`,
      issueType,
      message:
        issueType === 'failed_charge'
          ? 'Auto-created from a failed subscription payment.'
          : 'Auto-created from a subscription cancellation request.',
      occurredAt: createdAt,
      context,
      dedupeKey: `${context.subscriptionName}:${issueType}:${createdAt.toISOString().slice(0, 10)}`,
      actorId: 'system',
    });
    setSelectedTicketId(ticket.id);
  };

  const selectedActions = selectedTicket
    ? [
        {
          label: 'Refund',
          action: 'refund' as const,
          note: 'Refund processed from support ticket',
        },
        { label: 'Pause', action: 'pause' as const, note: 'Subscription paused by support' },
        { label: 'Cancel', action: 'cancel' as const, note: 'Subscription cancelled by support' },
      ]
    : [];

  const renderMetric = (label: string, value: string, hint: string, color: string) => (
    <Card style={styles.metricCard}>
      <View style={[styles.metricAccent, { backgroundColor: color }]} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricHint}>{hint}</Text>
    </Card>
  );

  const renderTicket = (ticket: SupportTicket) => {
    const isSelected = ticket.id === selectedTicket?.id;
    return (
      <TouchableOpacity
        key={ticket.id}
        onPress={() => setSelectedTicketId(ticket.id)}
        style={[styles.ticketCard, isSelected && styles.ticketCardSelected]}>
        <View style={styles.ticketHeader}>
          <Text style={styles.ticketTitle}>{ticket.title}</Text>
          <View style={[styles.statusPill, { borderColor: statusColors[ticket.status] }]}>
            <Text style={[styles.statusPillText, { color: statusColors[ticket.status] }]}>
              {ticket.status}
            </Text>
          </View>
        </View>
        <Text style={styles.ticketMeta}>
          {issueTypeLabels[ticket.issueType]} · {ticket.priority}
        </Text>
        <Text style={styles.ticketMeta}>
          {ticket.supportContext.subscriptionName} · {ticket.supportContext.planName} ·{' '}
          {ticket.supportContext.status}
        </Text>
        <Text style={styles.ticketMeta}>
          SLA due {new Date(ticket.sla.resolutionDueAt).toLocaleString()}
        </Text>
        <Text style={styles.ticketDescription} numberOfLines={2}>
          {ticket.description}
        </Text>
      </TouchableOpacity>
    );
  };

  const detailPanel = selectedTicket ? (
    <Card style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <View>
          <Text style={styles.sectionTitle}>{selectedTicket.title}</Text>
          <Text style={styles.detailSubtitle}>
            {selectedTicket.supportContext.subscriptionName} · {selectedTicket.subscriptionId}
          </Text>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColors[selectedTicket.status] }]}>
          <Text style={[styles.statusPillText, { color: statusColors[selectedTicket.status] }]}>
            {selectedTicket.status}
          </Text>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Plan context</Text>
          <Text style={styles.detailValue}>{selectedTicket.supportContext.planName}</Text>
          <Text style={styles.detailMeta}>
            {selectedTicket.supportContext.planTier} · {selectedTicket.supportContext.billingCycle}
          </Text>
          <Text style={styles.detailMeta}>
            {selectedTicket.supportContext.amount} {selectedTicket.supportContext.currency}
          </Text>
        </View>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Billing history</Text>
          <Text style={styles.detailValue}>
            {selectedTicket.supportContext.failedPayments} failed payments
          </Text>
          <Text style={styles.detailMeta}>
            {selectedTicket.supportContext.chargeCount} charge attempts
          </Text>
          <Text style={styles.detailMeta}>
            Created {new Date(selectedTicket.supportContext.createdAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>SLA</Text>
          <Text style={styles.detailValue}>{selectedTicket.sla.status}</Text>
          <Text style={styles.detailMeta}>
            First response by {new Date(selectedTicket.sla.firstResponseDueAt).toLocaleString()}
          </Text>
          <Text style={styles.detailMeta}>
            Resolution by {new Date(selectedTicket.sla.resolutionDueAt).toLocaleString()}
          </Text>
        </View>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Survey</Text>
          <Text style={styles.detailValue}>{selectedTicket.survey.status}</Text>
          <Text style={styles.detailMeta}>
            {selectedTicket.survey.rating
              ? `CSAT ${selectedTicket.survey.rating}/5`
              : 'Awaiting customer response'}
          </Text>
          <Text style={styles.detailMeta}>
            {selectedTicket.externalSystem
              ? `${selectedTicket.externalSystem} synced`
              : 'Internal queue'}
          </Text>
        </View>
      </View>

      <View style={styles.sectionSpacer}>
        <Text style={styles.subsectionTitle}>Agent actions</Text>
        <View style={styles.actionRow}>
          <Button
            title="Assign"
            size="small"
            variant="outline"
            onPress={() =>
              assignTicket(selectedTicket.id, integration.defaultAssignee ?? 'support-team')
            }
          />
          <Button
            title="Sync"
            size="small"
            variant="outline"
            onPress={() => syncTicket(selectedTicket.id)}
          />
          <Button
            title="Resolve"
            size="small"
            onPress={() => linkResolution(selectedTicket.id, selectedTicket.subscriptionId)}
          />
          <Button
            title="Survey"
            size="small"
            variant="secondary"
            onPress={() => submitSurvey(selectedTicket.id, 5, 'Issue resolved quickly.')}
          />
        </View>
        <View style={styles.actionRow}>
          {selectedActions.map((action) => (
            <Button
              key={action.label}
              title={action.label}
              size="small"
              variant="secondary"
              onPress={() =>
                performSupportAction(selectedTicket.id, action.action, 'agent-1', action.note)
              }
            />
          ))}
          <Button
            title="Pending customer"
            size="small"
            variant="outline"
            onPress={() => updateTicketStatus(selectedTicket.id, 'pending_customer')}
          />
        </View>
      </View>

      <View style={styles.sectionSpacer}>
        <Text style={styles.subsectionTitle}>Customer history</Text>
        {selectedTicket.supportContext.history.map((entry) => (
          <View key={entry} style={styles.historyRow}>
            <Text style={styles.historyBullet}>•</Text>
            <Text style={styles.historyText}>{entry}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionSpacer}>
        <Text style={styles.subsectionTitle}>Audit trail</Text>
        {selectedTicket.auditTrail.map((entry) => (
          <View key={entry.id} style={styles.auditRow}>
            <Text style={styles.auditText}>
              {entry.action} by {entry.actorId} · v{entry.version}
            </Text>
            <Text style={styles.auditMeta}>{entry.note}</Text>
          </View>
        ))}
      </View>
    </Card>
  ) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.kicker}>Support Ops</Text>
          <Text style={styles.title}>Billing support workspace</Text>
          <Text style={styles.subtitle}>
            Auto-created tickets for failed charges and cancellations, with subscription context,
            SLA tracking, customer surveys, external sync, and an audit trail for every agent
            action.
          </Text>
        </View>
        <View style={styles.heroActions}>
          <Button title="New failed charge" onPress={() => createSampleTicket('failed_charge')} />
          <Button
            title="New cancellation"
            variant="secondary"
            onPress={() => createSampleTicket('cancellation')}
          />
        </View>
      </View>

      <View style={[styles.metricGrid, isWide && styles.metricGridWide]}>
        {renderMetric(
          'Open tickets',
          metrics.open.toString(),
          'Awaiting first action',
          colors.warning
        )}
        {renderMetric('Assigned', metrics.assigned.toString(), 'With an agent', colors.primary)}
        {renderMetric('Resolved', metrics.resolved.toString(), 'Closed by support', colors.success)}
        {renderMetric(
          'SLA breaches',
          metrics.breached.toString(),
          'Past the deadline',
          colors.error
        )}
        {renderMetric(
          'Synced',
          metrics.synced.toString(),
          'Zendesk or Intercom link state',
          colors.accent
        )}
        {renderMetric(
          'Surveys',
          metrics.surveysCompleted.toString(),
          'CSAT responses captured',
          colors.secondary
        )}
      </View>

      <View style={[styles.workspace, isWide && styles.workspaceWide]}>
        <Card style={[styles.listCard, isWide && styles.halfWidth]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tickets</Text>
            <Text style={styles.sectionMeta}>{tickets.length} active</Text>
          </View>
          <View style={styles.integrationBar}>
            {(['internal', 'zendesk', 'intercom'] as const).map((provider) => (
              <TouchableOpacity
                key={provider}
                onPress={() =>
                  setIntegration({
                    ...integration,
                    provider,
                    enabled: true,
                  })
                }
                style={[
                  styles.integrationChip,
                  integration.provider === provider && styles.integrationChipActive,
                ]}>
                <Text style={styles.integrationChipText}>{provider}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tickets.map(renderTicket)}
        </Card>

        <View style={[styles.detailColumn, isWide && styles.halfWidth]}>{detailPanel}</View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  heroCopy: {
    flex: 1,
    maxWidth: 760,
  },
  heroActions: {
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  kicker: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  metricGrid: {
    gap: spacing.md,
  },
  metricGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metricCard: {
    flex: 1,
    minWidth: 160,
  },
  metricAccent: {
    width: 38,
    height: 4,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  metricValue: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  metricLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  metricHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  workspace: {
    gap: spacing.lg,
  },
  workspaceWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  halfWidth: {
    flexBasis: '49%',
  },
  listCard: {
    gap: spacing.md,
  },
  detailColumn: {
    gap: spacing.md,
  },
  detailCard: {
    gap: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.accent,
  },
  integrationBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  integrationChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  integrationChipActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  integrationChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  ticketCard: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  ticketCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'center',
  },
  ticketTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
  },
  ticketMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  ticketDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    backgroundColor: colors.background,
  },
  statusPillText: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  detailSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  detailBlock: {
    flexBasis: '48%',
    minWidth: 180,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: 4,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  detailMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sectionSpacer: {
    gap: spacing.sm,
  },
  subsectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  historyBullet: {
    ...typography.body,
    color: colors.primary,
    lineHeight: 20,
  },
  historyText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  auditRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  auditText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  auditMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});

export default SupportDashboardScreen;
