import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import {
  SubscriberPreference,
  CommCategory,
  CommChannel,
  buildDefaultPreferences,
  REQUIRED_CATEGORIES,
} from '../../backend/services/notification/commPreferencesTypes';

const CATEGORY_LABELS: Record<CommCategory, string> = {
  billing: 'Billing',
  product: 'Product Updates',
  marketing: 'Marketing & Promotions',
  security: 'Security Alerts',
  survey: 'Surveys & Feedback',
};

const CHANNEL_LABELS: Record<CommChannel, string> = {
  email: '✉️  Email',
  push: '🔔  Push',
  sms: '💬  SMS',
  in_app: '📱  In-App',
};

const CATEGORIES: CommCategory[] = ['billing', 'security', 'product', 'marketing', 'survey'];
const CHANNELS: CommChannel[] = ['email', 'push', 'sms', 'in_app'];

const CommunicationPreferencesScreen: React.FC = () => {
  const [prefs, setPrefs] = useState<SubscriberPreference>(() =>
    buildDefaultPreferences('current_user')
  );

  function toggle(category: CommCategory, channel: CommChannel, value: boolean) {
    const catPref = prefs.categories[category];

    // Prevent disabling all channels on required categories
    if (catPref.required && !value) {
      const otherEnabled = CHANNELS.filter((ch) => ch !== channel && catPref.channels[ch].enabled);
      if (otherEnabled.length === 0) return; // silently block
    }

    setPrefs((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [category]: {
          ...prev.categories[category],
          channels: {
            ...prev.categories[category].channels,
            [channel]: { ...prev.categories[category].channels[channel], enabled: value },
          },
        },
      },
      updatedAt: new Date().toISOString(),
      syncVersion: prev.syncVersion + 1,
    }));
    // In production: debounced PATCH to /api/preferences + WebSocket sync
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Communication Preferences</Text>
        <Text style={styles.subtitle}>Choose which notifications you receive and how.</Text>

        {CATEGORIES.map((category) => {
          const catPref = prefs.categories[category];
          const isRequired = REQUIRED_CATEGORIES.includes(category);

          return (
            <Card key={category} style={styles.categoryCard}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryLabel}>{CATEGORY_LABELS[category]}</Text>
                {isRequired && (
                  <View style={styles.requiredBadge}>
                    <Text style={styles.requiredText}>Required</Text>
                  </View>
                )}
              </View>

              {isRequired && (
                <Text style={styles.requiredNote}>
                  Required for service — cannot be fully disabled
                </Text>
              )}

              {CHANNELS.map((channel) => {
                const enabled = catPref.channels[channel].enabled;
                return (
                  <View key={channel} style={styles.channelRow}>
                    <Text style={styles.channelLabel}>{CHANNEL_LABELS[channel]}</Text>
                    <Switch
                      value={enabled}
                      onValueChange={(val) => toggle(category, channel, val)}
                      trackColor={{ false: colors.border, true: colors.primary + '88' }}
                      thumbColor={enabled ? colors.primary : colors.textSecondary}
                      accessibilityLabel={`${CHANNEL_LABELS[channel]} for ${CATEGORY_LABELS[category]}`}
                    />
                  </View>
                );
              })}
            </Card>
          );
        })}

        <Text style={styles.footer}>
          Changes sync across your devices in real-time. Last updated:{' '}
          {new Date(prefs.updatedAt).toLocaleString()}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default CommunicationPreferencesScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.lg },
  categoryCard: { marginBottom: spacing.md, padding: spacing.md },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  categoryLabel: { ...typography.h3, color: colors.text, flex: 1 },
  requiredBadge: {
    backgroundColor: colors.primary + '22',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  requiredText: { ...typography.small, color: colors.primary, fontWeight: '600' },
  requiredNote: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  channelLabel: { ...typography.body2, color: colors.text },
  footer: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
