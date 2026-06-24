import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';

import { Card } from '../components/common/Card';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

type Role = 'Admin' | 'Merchant' | 'Subscriber' | 'Auditor';
type Permission =
  | 'GrantRole'
  | 'RevokeRole'
  | 'DelegatePermission'
  | 'CreatePlan'
  | 'DeactivatePlan'
  | 'SetPlanQuotas'
  | 'SetRevenueRule'
  | 'Subscribe'
  | 'CancelSubscription'
  | 'PauseSubscription'
  | 'ResumeSubscription'
  | 'ChargeSubscription'
  | 'RequestRefund'
  | 'ApproveRefund'
  | 'RejectRefund'
  | 'RequestTransfer'
  | 'AcceptTransfer'
  | 'SetRateLimit'
  | 'RemoveRateLimit'
  | 'SetInvoiceContract'
  | 'ClearInvoiceContract'
  | 'UpgradeContract'
  | 'MigrateContract'
  | 'ViewAnalytics'
  | 'ViewAuditLog'
  | 'ViewPlans'
  | 'ViewSubscriptions'
  | 'SetEmergencyAdmin'
  | 'PauseEmergency'
  | 'SetAccessControl';

interface UserRoleEntry {
  address: string;
  label: string;
  roles: Role[];
}

interface RoleChangeEntry {
  id: number;
  user: string;
  role: Role;
  action: 'Granted' | 'Revoked';
  changedBy: string;
  timestamp: number;
}

interface DelegationEntry {
  delegator: string;
  delegate: string;
  permission: Permission;
  expiresAt: number;
}

const ROLE_OPTIONS: Role[] = ['Admin', 'Merchant', 'Subscriber', 'Auditor'];

const PERMISSION_LABELS: Record<Permission, string> = {
  GrantRole: 'Grant roles to users',
  RevokeRole: 'Revoke roles from users',
  DelegatePermission: 'Delegate permissions',
  CreatePlan: 'Create subscription plans',
  DeactivatePlan: 'Deactivate plans',
  SetPlanQuotas: 'Set plan quotas',
  SetRevenueRule: 'Set revenue rules',
  Subscribe: 'Subscribe to plans',
  CancelSubscription: 'Cancel subscriptions',
  PauseSubscription: 'Pause subscriptions',
  ResumeSubscription: 'Resume subscriptions',
  ChargeSubscription: 'Process charges',
  RequestRefund: 'Request refunds',
  ApproveRefund: 'Approve refunds',
  RejectRefund: 'Reject refunds',
  RequestTransfer: 'Request transfers',
  AcceptTransfer: 'Accept transfers',
  SetRateLimit: 'Configure rate limits',
  RemoveRateLimit: 'Remove rate limits',
  SetInvoiceContract: 'Set invoice contract',
  ClearInvoiceContract: 'Clear invoice contract',
  UpgradeContract: 'Upgrade contract',
  MigrateContract: 'Migrate contract data',
  ViewAnalytics: 'View analytics',
  ViewAuditLog: 'View audit log',
  ViewPlans: 'View plans',
  ViewSubscriptions: 'View subscriptions',
  SetEmergencyAdmin: 'Set emergency admin',
  PauseEmergency: 'Pause system',
  SetAccessControl: 'Configure access control',
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: Object.keys(PERMISSION_LABELS) as Permission[],
  Merchant: [
    'CreatePlan',
    'DeactivatePlan',
    'SetPlanQuotas',
    'SetRevenueRule',
    'ViewPlans',
    'ViewSubscriptions',
  ],
  Subscriber: [
    'Subscribe',
    'CancelSubscription',
    'PauseSubscription',
    'ResumeSubscription',
    'ChargeSubscription',
    'RequestRefund',
    'RequestTransfer',
    'AcceptTransfer',
  ],
  Auditor: ['ViewAnalytics', 'ViewAuditLog', 'ViewPlans', 'ViewSubscriptions'],
};

const SAMPLE_USERS: UserRoleEntry[] = [
  { address: 'GABCD...1234', label: 'Alice (Admin)', roles: ['Admin'] },
  { address: 'GEFGH...5678', label: 'Bob (Merchant)', roles: ['Merchant'] },
  { address: 'GIJKL...9012', label: 'Charlie (Subscriber)', roles: ['Subscriber'] },
  { address: 'GMNOP...3456', label: 'Diana (Auditor)', roles: ['Auditor'] },
];

const SAMPLE_HISTORY: RoleChangeEntry[] = [
  {
    id: 1,
    user: 'GABCD...1234',
    role: 'Admin',
    action: 'Granted',
    changedBy: 'System',
    timestamp: Date.now() - 86400000,
  },
  {
    id: 2,
    user: 'GEFGH...5678',
    role: 'Merchant',
    action: 'Granted',
    changedBy: 'GABCD...1234',
    timestamp: Date.now() - 43200000,
  },
  {
    id: 3,
    user: 'GIJKL...9012',
    role: 'Subscriber',
    action: 'Granted',
    changedBy: 'GABCD...1234',
    timestamp: Date.now() - 21600000,
  },
];

const SAMPLE_DELEGATIONS: DelegationEntry[] = [
  {
    delegator: 'GEFGH...5678',
    delegate: 'GQRST...7890',
    permission: 'ViewPlans',
    expiresAt: Date.now() + 3600000,
  },
];

const RoleManagementScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'permissions' | 'history' | 'delegations'>(
    'users'
  );
  const [users] = useState<UserRoleEntry[]>(SAMPLE_USERS);
  const [history] = useState<RoleChangeEntry[]>(SAMPLE_HISTORY);
  const [delegations] = useState<DelegationEntry[]>(SAMPLE_DELEGATIONS);

  const handleGrantRole = (user: UserRoleEntry, role: Role) => {
    Alert.alert('Grant Role', `Grant ${role} role to ${user.label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grant',
        onPress: () => Alert.alert('Success', `${role} role granted to ${user.label}`),
      },
    ]);
  };

  const handleRevokeRole = (user: UserRoleEntry, role: Role) => {
    Alert.alert('Revoke Role', `Revoke ${role} role from ${user.label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        onPress: () => Alert.alert('Success', `${role} role revoked from ${user.label}`),
      },
    ]);
  };

  const renderUserRow = (user: UserRoleEntry) => (
    <Card key={user.address} style={styles.userCard}>
      <View style={styles.userInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.label[0]}</Text>
        </View>
        <View style={styles.userDetails}>
          <Text style={styles.userName}>{user.label}</Text>
          <Text style={styles.userAddress}>{user.address}</Text>
          <View style={styles.roleBadges}>
            {user.roles.map((role) => (
              <View key={role} style={[styles.roleBadge, styles[`roleBadge_${role}`]]}>
                <Text style={styles.roleBadgeText}>{role}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <View style={styles.userActions}>
        {ROLE_OPTIONS.map((role) => {
          const hasRole = user.roles.includes(role);
          return (
            <TouchableOpacity
              key={role}
              style={[styles.roleToggle, hasRole && styles.roleToggleActive]}
              onPress={() =>
                hasRole ? handleRevokeRole(user, role) : handleGrantRole(user, role)
              }>
              <Text style={[styles.roleToggleText, hasRole && styles.roleToggleTextActive]}>
                {role}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );

  const renderPermissionRow = (permission: Permission) => (
    <View key={permission} style={styles.permissionRow}>
      <View style={styles.permissionInfo}>
        <Text style={styles.permissionName}>{permission}</Text>
        <Text style={styles.permissionDesc}>{PERMISSION_LABELS[permission]}</Text>
      </View>
      <View style={styles.permissionRoles}>
        {(Object.entries(ROLE_PERMISSIONS) as [Role, Permission[]][])
          .filter(([_, perms]) => perms.includes(permission))
          .map(([role]) => (
            <View key={role} style={[styles.miniBadge, styles[`miniBadge_${role}`]]}>
              <Text style={styles.miniBadgeText}>{role}</Text>
            </View>
          ))}
      </View>
    </View>
  );

  const renderHistoryRow = (entry: RoleChangeEntry) => (
    <View key={entry.id} style={styles.historyRow}>
      <View style={styles.historyDot}>
        <View
          style={[styles.dot, entry.action === 'Granted' ? styles.dotGranted : styles.dotRevoked]}
        />
      </View>
      <View style={styles.historyInfo}>
        <Text style={styles.historyText}>
          <Text style={styles.historyBold}>{entry.action}</Text> {entry.role} for {entry.user}
        </Text>
        <Text style={styles.historyMeta}>
          by {entry.changedBy} · {new Date(entry.timestamp).toLocaleString()}
        </Text>
      </View>
    </View>
  );

  const renderDelegationRow = (del: DelegationEntry) => (
    <Card key={`${del.delegator}-${del.delegate}-${del.permission}`} style={styles.delegationCard}>
      <View style={styles.delegationInfo}>
        <Text style={styles.delegationText}>
          <Text style={styles.bold}>{del.delegator}</Text> →{' '}
          <Text style={styles.bold}>{del.delegate}</Text>
        </Text>
        <Text style={styles.delegationPerm}>{PERMISSION_LABELS[del.permission]}</Text>
        <Text style={styles.delegationExpiry}>
          Expires: {new Date(del.expiresAt).toLocaleString()}
        </Text>
      </View>
    </Card>
  );

  const TABS: { key: typeof activeTab; label: string }[] = [
    { key: 'users', label: 'Users & Roles' },
    { key: 'permissions', label: 'Permissions' },
    { key: 'history', label: 'Audit Log' },
    { key: 'delegations', label: 'Delegations' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Role Management</Text>
        <Text style={styles.subtitle}>Manage access control for subscription operations</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}>
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.content}>
        {activeTab === 'users' && (
          <View>
            <Text style={styles.sectionTitle}>All Users</Text>
            <Text style={styles.sectionSubtitle}>Tap a role to grant or revoke it for a user</Text>
            {users.map(renderUserRow)}
          </View>
        )}

        {activeTab === 'permissions' && (
          <View>
            <Text style={styles.sectionTitle}>Permission Map</Text>
            <Text style={styles.sectionSubtitle}>Each role grants the following permissions</Text>
            <Card style={styles.permissionCard}>
              {(Object.keys(PERMISSION_LABELS) as Permission[]).map(renderPermissionRow)}
            </Card>
          </View>
        )}

        {activeTab === 'history' && (
          <View>
            <Text style={styles.sectionTitle}>Role Change History</Text>
            <Text style={styles.sectionSubtitle}>
              Chronological log of all role grants and revocations
            </Text>
            <Card style={styles.historyCard}>{history.map(renderHistoryRow)}</Card>
          </View>
        )}

        {activeTab === 'delegations' && (
          <View>
            <Text style={styles.sectionTitle}>Active Delegations</Text>
            <Text style={styles.sectionSubtitle}>
              Time-limited permission grants from one user to another
            </Text>
            {delegations.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No active delegations</Text>
              </Card>
            ) : (
              delegations.map(renderDelegationRow)
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tabBar: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    borderRadius: borderRadius.round,
    backgroundColor: colors.surfaceVariant,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.md,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  userCard: {
    marginBottom: spacing.md,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.round,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    ...typography.h3,
    color: colors.onPrimary,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  userAddress: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleBadges: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  roleBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
  },
  roleBadge_Admin: {
    backgroundColor: colors.error,
  },
  roleBadge_Merchant: {
    backgroundColor: colors.primary,
  },
  roleBadge_Subscriber: {
    backgroundColor: colors.accent,
  },
  roleBadge_Auditor: {
    backgroundColor: colors.warning,
  },
  roleBadgeText: {
    ...typography.small,
    color: colors.text,
    fontWeight: '600',
  },
  userActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  roleToggle: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleToggleActive: {
    backgroundColor: colors.surfaceVariant,
    borderColor: colors.primary,
  },
  roleToggleText: {
    ...typography.small,
    color: colors.textSecondary,
  },
  roleToggleTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  permissionCard: {
    marginBottom: spacing.lg,
  },
  permissionRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  permissionInfo: {
    flex: 1,
  },
  permissionName: {
    ...typography.body2,
    color: colors.text,
    fontWeight: '600',
  },
  permissionDesc: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  permissionRoles: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  miniBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: borderRadius.sm,
  },
  miniBadge_Admin: {
    backgroundColor: colors.error,
  },
  miniBadge_Merchant: {
    backgroundColor: colors.primary,
  },
  miniBadge_Subscriber: {
    backgroundColor: colors.accent,
  },
  miniBadge_Auditor: {
    backgroundColor: colors.warning,
  },
  miniBadgeText: {
    fontSize: 10,
    color: colors.text,
    fontWeight: '600',
  },
  historyCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  historyRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyDot: {
    width: 24,
    alignItems: 'center',
    paddingTop: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGranted: {
    backgroundColor: colors.success,
  },
  dotRevoked: {
    backgroundColor: colors.error,
  },
  historyInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  historyText: {
    ...typography.body2,
    color: colors.text,
  },
  historyBold: {
    fontWeight: '700',
  },
  historyMeta: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  delegationCard: {
    marginBottom: spacing.md,
  },
  delegationInfo: {
    padding: spacing.sm,
  },
  delegationText: {
    ...typography.body2,
    color: colors.text,
  },
  bold: {
    fontWeight: '700',
  },
  delegationPerm: {
    ...typography.small,
    color: colors.accent,
    marginTop: 4,
  },
  delegationExpiry: {
    ...typography.small,
    color: colors.warning,
    marginTop: 2,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

export default RoleManagementScreen;
