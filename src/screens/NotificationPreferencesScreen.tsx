import React from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { useNotificationPreferencesStore } from '../store/notificationPreferencesStore';
import type { OptInCategory, NotificationPriority } from '../services/pushScheduleEngine';

const OPT_IN_LABELS: Record<OptInCategory, { label: string; desc: string }> = {
  billing: { label: 'Billing & Payments', desc: 'Payment due, charge results, invoice ready' },
  product: { label: 'Product Updates', desc: 'New features, improvements, announcements' },
  marketing: { label: 'Promotions', desc: 'Offers, discounts, and promotional campaigns' },
  security: { label: 'Security', desc: 'Login alerts, suspicious activity, 2FA prompts' },
};

const PRIORITY_LABELS: Record<NotificationPriority, { label: string; desc: string }> = {
  critical: { label: 'Critical only', desc: 'Payment failures & security alerts only' },
  informative: { label: 'Important & critical', desc: 'Exclude marketing promotions' },
  marketing: { label: 'All notifications', desc: 'Including promotional messages' },
};

const DIGEST_OPTIONS: {
  value: 'immediate' | 'daily' | 'weekly';
  label: string;
  desc: string;
}[] = [
  { value: 'immediate', label: 'Immediate', desc: 'Send each notification as it happens' },
  {
    value: 'daily',
    label: 'Daily digest',
    desc: 'Bundle non-critical alerts into one daily summary',
  },
  {
    value: 'weekly',
    label: 'Weekly digest',
    desc: 'Bundle non-critical alerts into one weekly summary',
  },
];

const NotificationPreferencesScreen = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { preferences, toggleCategory, setQuietHours, updatePreferences } =
    useNotificationPreferencesStore();

  const priorityOrder: NotificationPriority[] = ['critical', 'informative', 'marketing'];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Notification Preferences screen">
      <Text style={styles.title}>Notification Preferences</Text>
      <Text style={styles.subtitle}>
        Control which notifications you receive, when they're delivered, and how they're batched.
      </Text>

      {/* Opt-in categories */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notification categories</Text>
        {(Object.keys(OPT_IN_LABELS) as OptInCategory[]).map((category) => {
          const { label, desc } = OPT_IN_LABELS[category];
          const isOn = preferences.optInCategories[category];
          const isCritical = category === 'billing' || category === 'security';
          return (
            <View key={category} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowDesc}>{desc}</Text>
                {isCritical && (
                  <Text style={styles.requiredTag}>Recommended for account safety</Text>
                )}
              </View>
              <Switch
                value={isOn}
                onValueChange={() => toggleCategory(category)}
                accessibilityLabel={`Toggle ${label} notifications`}
                accessibilityRole="switch"
                accessibilityState={{ checked: isOn }}
              />
            </View>
          );
        })}
      </View>

      {/* Minimum priority filter */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Minimum priority</Text>
        {priorityOrder.map((priority) => {
          const { label, desc } = PRIORITY_LABELS[priority];
          const selected = preferences.minimumPriority === priority;
          return (
            <TouchableOpacity
              key={priority}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => updatePreferences({ minimumPriority: priority })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}>
              <View style={styles.radioCircle}>
                {selected && <View style={styles.radioFill} />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowDesc}>{desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Digest batching */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Delivery batching</Text>
        {DIGEST_OPTIONS.map(({ value, label, desc }) => {
          const selected = preferences.digestFrequency === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => updatePreferences({ digestFrequency: value })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}>
              <View style={styles.radioCircle}>
                {selected && <View style={styles.radioFill} />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowDesc}>{desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Quiet hours */}
      <View style={styles.card}>
        <View style={styles.rowSpaceBetween}>
          <View style={styles.rowText}>
            <Text style={styles.cardTitle}>Quiet hours</Text>
            <Text style={styles.rowDesc}>
              Pause non-critical notifications during the specified time window.
            </Text>
          </View>
          <Switch
            value={preferences.quietHours.enabled}
            onValueChange={(val) => setQuietHours({ enabled: val })}
            accessibilityLabel="Enable quiet hours"
            accessibilityRole="switch"
            accessibilityState={{ checked: preferences.quietHours.enabled }}
          />
        </View>

        {preferences.quietHours.enabled && (
          <View style={styles.quietHoursDetail}>
            <View style={styles.timeRow}>
              <Text style={styles.rowDesc}>
                Start hour (UTC): {preferences.quietHours.startHour}:00
              </Text>
              <View style={styles.timeButtons}>
                {[20, 21, 22, 23].map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[
                      styles.timeBtn,
                      preferences.quietHours.startHour === h && styles.timeBtnActive,
                    ]}
                    onPress={() => setQuietHours({ startHour: h })}
                    accessibilityRole="button"
                    accessibilityLabel={`Set quiet hours start to ${h}:00`}>
                    <Text style={styles.timeBtnText}>{h}:00</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.rowDesc}>
                End hour (UTC): {preferences.quietHours.endHour}:00
              </Text>
              <View style={styles.timeButtons}>
                {[6, 7, 8, 9].map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[
                      styles.timeBtn,
                      preferences.quietHours.endHour === h && styles.timeBtnActive,
                    ]}
                    onPress={() => setQuietHours({ endHour: h })}
                    accessibilityRole="button"
                    accessibilityLabel={`Set quiet hours end to ${h}:00`}>
                    <Text style={styles.timeBtnText}>{h}:00</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={styles.rowDesc}>
              Timezone changes mid-subscription are handled automatically via device locale.
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.footer}>
        A/B test variant: {preferences.abVariant} — notification copy and timing may vary as we
        optimize delivery for you.
      </Text>
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: colors.text.primary, marginBottom: 8 },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20, lineHeight: 20 },
    card: {
      backgroundColor: colors.background.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginBottom: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    rowSpaceBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowText: { flex: 1, paddingRight: 8 },
    rowLabel: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    rowDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
    requiredTag: { fontSize: 11, color: colors.primary, marginTop: 4, fontWeight: '500' },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    optionRowSelected: { backgroundColor: colors.primary + '11', borderRadius: 8 },
    radioCircle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    quietHoursDetail: { marginTop: 12 },
    timeRow: { marginBottom: 12 },
    timeButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    timeBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    timeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    timeBtnText: { fontSize: 13, color: colors.text.primary },
    footer: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  });
}

export default NotificationPreferencesScreen;
