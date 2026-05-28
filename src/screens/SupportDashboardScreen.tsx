import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ListScreen } from '../components/common/ScreenTemplates';
import { useSupportStore } from '../store';
import { SupportTicket } from '../types/support';
import { colors, spacing, typography } from '../utils/constants';

const SupportDashboardScreen: React.FC = () => {
  const { tickets, createTicket, assignTicket, syncTicket, linkResolution } = useSupportStore();

  const handleCreateTicket = () => {
    createTicket({
      subscriptionId: `sub-${tickets.length + 1}`,
      issueType: 'failed_charge',
      message: 'Automatic ticket created from a failed subscription charge.',
      occurredAt: new Date(),
    });
  };

  const renderTicket = (ticket: SupportTicket) => (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>{ticket.title}</Text>
      <Text style={styles.meta}>Priority: {ticket.priority}</Text>
      <Text style={styles.meta}>Status: {ticket.status}</Text>
      <Text style={styles.meta}>Subscription: {ticket.subscriptionId}</Text>
      {ticket.externalTicketId ? <Text style={styles.meta}>External: {ticket.externalTicketId}</Text> : null}
      <View style={styles.actions}>
        <Button title="Assign" size="small" variant="outline" onPress={() => assignTicket(ticket.id, 'support-team')} />
        <Button title="Sync" size="small" variant="outline" onPress={() => syncTicket(ticket.id)} />
        <Button title="Resolve" size="small" onPress={() => linkResolution(ticket.id, ticket.subscriptionId)} />
      </View>
    </Card>
  );

  return (
    <ListScreen
      title="Support"
      subtitle="Subscription event tickets and external support sync"
      analyticsName="SupportDashboard"
      data={tickets}
      renderItem={renderTicket}
      keyExtractor={(ticket) => ticket.id}
      emptyTitle="No tickets"
      emptyMessage="Failed charges, cancellations, and disputes can create support tickets automatically."
      emptyActionText="Create sample ticket"
      onEmptyAction={handleCreateTicket}
      rightAction={<Button title="New" size="small" onPress={handleCreateTicket} />}
      testID="support-dashboard-screen"
    />
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
    textTransform: 'capitalize',
  },
  meta: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});

export default SupportDashboardScreen;
