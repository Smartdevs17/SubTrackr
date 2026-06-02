import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useCampaignStore } from '../store/campaignStore';
import { Card } from '../components/common/Card';
import {
  Campaign,
  CampaignType,
  CampaignStatus,
  DeliveryChannel,
  AutomationTrigger,
} from '../types/campaign';

const CampaignManagementScreen: React.FC = () => {
  const {
    campaigns,
    isLoading,
    error,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    launchCampaign,
    pauseCampaign,
    getCampaignAnalytics,
  } = useCampaignStore();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    type: CampaignType.WELCOME,
    target: { segmentIds: [] },
    content: { title: '', body: '' },
    channels: [DeliveryChannel.EMAIL],
  });

  const handleCreateCampaign = useCallback(async () => {
    if (!newCampaign.name || !newCampaign.content.title) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    await createCampaign({
      ...newCampaign,
      status: CampaignStatus.DRAFT,
    });
    setCreateModalVisible(false);
    setNewCampaign({
      name: '',
      type: CampaignType.WELCOME,
      target: { segmentIds: [] },
      content: { title: '', body: '' },
      channels: [DeliveryChannel.EMAIL],
    });
    Alert.alert('Success', 'Campaign created!');
  }, [newCampaign, createCampaign]);

  const getStatusColor = (status: CampaignStatus): string => {
    switch (status) {
      case CampaignStatus.ACTIVE:
        return colors.success;
      case CampaignStatus.PAUSED:
        return colors.warning;
      case CampaignStatus.COMPLETED:
        return colors.textSecondary;
      default:
        return colors.primary;
    }
  };

  const getTypeLabel = (type: CampaignType): string => {
    switch (type) {
      case CampaignType.WELCOME:
        return 'Welcome';
      case CampaignType.RETENTION:
        return 'Retention';
      case CampaignType.RE_ENGAGEMENT:
        return 'Re-engagement';
      case CampaignType.PROMOTIONAL:
        return 'Promotional';
      case CampaignType.WINBACK:
        return 'Win-back';
    }
  };

  const renderCampaignItem = (campaign: Campaign) => {
    const analytics = campaign.analytics;

    return (
      <Card style={styles.campaignCard}>
        <View style={styles.campaignHeader}>
          <View>
            <Text style={styles.campaignName}>{campaign.name}</Text>
            <View style={styles.campaignMeta}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(campaign.status) },
                ]}>
                <Text style={styles.statusBadgeText}>{campaign.status}</Text>
              </View>
              <Text style={styles.campaignType}>{getTypeLabel(campaign.type)}</Text>
            </View>
          </View>
          <View style={styles.campaignActions}>
            {campaign.status === CampaignStatus.DRAFT && (
              <TouchableOpacity
                style={styles.launchButton}
                onPress={() => launchCampaign(campaign.id)}>
                <Text style={styles.launchButtonText}>Launch</Text>
              </TouchableOpacity>
            )}
            {campaign.status === CampaignStatus.ACTIVE && (
              <TouchableOpacity
                style={styles.pauseButton}
                onPress={() => pauseCampaign(campaign.id)}>
                <Text style={styles.pauseButtonText}>Pause</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => {
                Alert.alert('Delete Campaign', 'Are you sure?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => deleteCampaign(campaign.id),
                  },
                ]);
              }}>
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        {analytics && (
          <View style={styles.analyticsGrid}>
            <View style={styles.analyticsItem}>
              <Text style={styles.analyticsValue}>
                {analytics.totalRecipients}
              </Text>
              <Text style={styles.analyticsLabel}>Recipients</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={styles.analyticsValue}>{analytics.deliveredCount}</Text>
              <Text style={styles.analyticsLabel}>Delivered</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={styles.analyticsValue}>
                {analytics.totalRecipients > 0
                  ? Math.round((analytics.openedCount / analytics.totalRecipients) * 100)
                  : 0}
                %
              </Text>
              <Text style={styles.analyticsLabel}>Open Rate</Text>
            </View>
            <View style={styles.analyticsItem}>
              <Text style={styles.analyticsValue}>
                {analytics.totalRecipients > 0
                  ? Math.round((analytics.clickedCount / analytics.totalRecipients) * 100)
                  : 0}
                %
              </Text>
              <Text style={styles.analyticsLabel}>Click Rate</Text>
            </View>
          </View>
        )}

        <View style={styles.channelsRow}>
          {campaign.channels.map((channel) => (
            <View key={channel} style={styles.channelBadge}>
              <Text style={styles.channelBadgeText}>{channel}</Text>
            </View>
          ))}
        </View>
      </Card>
    );
  };

  const renderCreateModal = () => (
    <Modal
      visible={createModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setCreateModalVisible(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
            <Text style={styles.closeButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Create Campaign</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView style={styles.modalScroll}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Campaign Name *</Text>
            <TextInput
              style={styles.input}
              value={newCampaign.name}
              onChangeText={(text) => setNewCampaign({ ...newCampaign, name: text })}
              placeholder="Enter campaign name"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Campaign Type</Text>
            <View style={styles.typeGrid}>
              {Object.values(CampaignType).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeOption,
                    newCampaign.type === type && styles.typeOptionSelected,
                  ]}
                  onPress={() => setNewCampaign({ ...newCampaign, type })}>
                  <Text
                    style={[
                      styles.typeOptionText,
                      newCampaign.type === type && styles.typeOptionTextSelected,
                    ]}>
                    {getTypeLabel(type)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              value={newCampaign.content.title}
              onChangeText={(text) =>
                setNewCampaign({
                  ...newCampaign,
                  content: { ...newCampaign.content, title: text },
                })
              }
              placeholder="Enter title"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Message</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={newCampaign.content.body}
              onChangeText={(text) =>
                setNewCampaign({
                  ...newCampaign,
                  content: { ...newCampaign.content, body: text },
                })
              }
              placeholder="Enter message"
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Delivery Channels</Text>
            <View style={styles.channelGrid}>
              {Object.values(DeliveryChannel).map((channel) => (
                <TouchableOpacity
                  key={channel}
                  style={[
                    styles.channelOption,
                    newCampaign.channels.includes(channel) &&
                      styles.channelOptionSelected,
                  ]}
                  onPress={() => {
                    const channels = newCampaign.channels.includes(channel)
                      ? newCampaign.channels.filter((c) => c !== channel)
                      : [...newCampaign.channels, channel];
                    setNewCampaign({ ...newCampaign, channels });
                  }}>
                  <Text
                    style={[
                      styles.channelOptionText,
                      newCampaign.channels.includes(channel) &&
                        styles.channelOptionTextSelected,
                    ]}>
                    {channel}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.createButton}
            onPress={handleCreateCampaign}>
            <Text style={styles.createButtonText}>Create Campaign</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Campaign Management</Text>
          <Text style={styles.subtitle}>
            Create and manage marketing campaigns
          </Text>
        </View>

        <TouchableOpacity
          style={styles.newButton}
          onPress={() => setCreateModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Create new campaign">
          <Text style={styles.newButtonText}>+ New Campaign</Text>
        </TouchableOpacity>

        {campaigns.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>No campaigns yet</Text>
            <Text style={styles.emptySubtext}>
              Create your first campaign to get started
            </Text>
          </Card>
        ) : (
          campaigns.map(renderCampaignItem)
        )}
      </ScrollView>

      {renderCreateModal()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizeMd,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  newButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    margin: spacing.md,
    alignItems: 'center',
  },
  newButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
  campaignCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  campaignHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  campaignName: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  campaignMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  statusBadgeText: {
    color: colors.text,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    textTransform: 'capitalize',
  },
  campaignType: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
  },
  campaignActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  launchButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.success,
  },
  launchButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
  },
  pauseButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.warning,
  },
  pauseButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
  },
  deleteButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteButtonText: {
    color: colors.danger,
    fontSize: typography.fontSizeSm,
  },
  analyticsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
  },
  analyticsItem: {
    alignItems: 'center',
  },
  analyticsValue: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  analyticsLabel: {
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  channelsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  channelBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
  },
  channelBadgeText: {
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  emptyCard: {
    padding: spacing.lg,
    margin: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeButton: {
    fontSize: typography.fontSizeMd,
    color: colors.primary,
  },
  modalTitle: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  modalScroll: {
    flex: 1,
    padding: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.fontSizeMd,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeOptionText: {
    fontSize: typography.fontSizeSm,
    color: colors.text,
  },
  typeOptionTextSelected: {
    fontWeight: typography.fontWeightBold,
  },
  channelGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  channelOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  channelOptionText: {
    fontSize: typography.fontSizeSm,
    color: colors.text,
    textTransform: 'uppercase',
  },
  channelOptionTextSelected: {
    fontWeight: typography.fontWeightBold,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  createButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
});

export default CampaignManagementScreen;