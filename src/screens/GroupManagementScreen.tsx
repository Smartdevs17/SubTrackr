import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ListScreen } from '../components/common/ScreenTemplates';
import { useGroupStore } from '../store';
import { SubscriptionGroup } from '../types/group';
import { colors, spacing, typography } from '../utils/constants';

const OWNER_ADDRESS = 'owner@example.com';

const GroupManagementScreen: React.FC = () => {
  const { groups, createGroup, inviteMember, chargeGroup, getAnalytics, error } = useGroupStore();

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    [groups]
  );

  const handleCreateGroup = () => {
    createGroup(OWNER_ADDRESS, {
      name: `Family Plan ${groups.length + 1}`,
      planSharingRules: {
        seatLimit: 5,
        usagePoolLimit: 10_000,
        ownerPaysForMembers: true,
        allowMemberOverages: false,
      },
    });
  };

  const renderGroup = (group: SubscriptionGroup) => {
    const analytics = getAnalytics(group.groupId);

    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{group.name}</Text>
        <Text style={styles.meta}>Owner: {group.owner}</Text>
        <Text style={styles.meta}>
          Seats: {analytics?.activeSeats ?? group.members.length}/{group.planSharingRules.seatLimit}
        </Text>
        <Text style={styles.meta}>
          Outstanding: ${analytics?.outstandingBalance.toFixed(2) ?? '0.00'}
        </Text>
        <View style={styles.actions}>
          <Button
            title="Invite"
            size="small"
            variant="outline"
            onPress={() =>
              inviteMember(group.groupId, `member${group.members.length}@example.com`, group.owner)
            }
          />
          <Button title="Charge $49" size="small" onPress={() => chargeGroup(group.groupId, 49)} />
        </View>
      </Card>
    );
  };

  return (
    <ListScreen
      title="Groups"
      subtitle="Family plans, team seats, and consolidated billing"
      analyticsName="GroupManagement"
      data={sortedGroups}
      renderItem={renderGroup}
      keyExtractor={(group) => group.groupId}
      emptyTitle="No groups yet"
      emptyMessage="Create a group to manage shared subscriptions and owner-paid billing."
      emptyActionText="Create group"
      onEmptyAction={handleCreateGroup}
      error={error}
      rightAction={<Button title="New" size="small" onPress={handleCreateGroup} />}
      testID="group-management-screen"
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
  },
  meta: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});

export default GroupManagementScreen;
