/**
 * Template version history (#1748)
 *
 * Lists every version of a notification template with its save time and a
 * rollback action. Rolling back does not rewrite history — it republishes the
 * chosen version's content as the next version (marked "Restored from vN"), so
 * version numbers stay monotonic and a message sent after a rollback is still
 * distinguishable from one sent before the bad edit.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';

import { useThemeColors } from '../hooks/useThemeColors';
import { useAppRoute } from '../navigation/types';
import {
  useNotificationTemplateStore,
  type NotificationTemplateVersion,
} from '../store/notificationTemplateStore';
import { NOTIFICATION_TYPE_META, type NotificationChannel } from '../types/notification';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  push: 'Push',
  sms: 'SMS',
  in_app: 'In-app',
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const TemplateVersionHistoryScreen = () => {
  const route = useAppRoute<'TemplateVersionHistory'>();
  const { type, channel } = route.params;
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const versions = useNotificationTemplateStore((s) => s.listVersions(type, channel));
  const rollback = useNotificationTemplateStore((s) => s.rollback);

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const currentVersion = versions.length === 0 ? null : versions[versions.length - 1]!.version;

  const onRollback = (target: NotificationTemplateVersion): void => {
    setPendingId(target.id);
    rollback(type, channel, target.version);
    setPendingId(null);
  };

  const title = `${NOTIFICATION_TYPE_META[type]?.label ?? type} · ${CHANNEL_LABELS[channel]}`;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Template version history screen">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>
        Every saved version, newest last. Roll back to republish an earlier version's content as a
        new version.
      </Text>

      {versions.length === 0 ? (
        <View style={styles.empty} testID="template-versions-empty">
          <Text style={styles.emptyTitle}>No versions yet</Text>
          <Text style={styles.emptyDesc}>Saving this template will start its history.</Text>
        </View>
      ) : (
        versions.map((version) => {
          const isCurrent = version.version === currentVersion;
          return (
            <View
              key={version.version}
              style={styles.card}
              testID={`template-version-${version.version}`}>
              <View style={styles.cardHeader}>
                <Text style={styles.versionLabel}>Version {version.version}</Text>
                {isCurrent && <Text style={styles.currentBadge}>Current</Text>}
              </View>
              <Text style={styles.versionSubject} numberOfLines={2}>
                {version.subject}
              </Text>
              <Text style={styles.versionMeta}>
                {formatTime(version.createdAt)}
                {version.restoredFrom ? ` · Restored from v${version.restoredFrom}` : ''}
              </Text>

              {!isCurrent && (
                <TouchableOpacity
                  style={styles.rollbackButton}
                  onPress={() => onRollback(version)}
                  disabled={pendingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Roll back to version ${version.version}`}
                  testID={`template-rollback-${version.version}`}>
                  <Text style={styles.rollbackText}>Roll back to this version</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 22, fontWeight: '700', color: colors.text.primary },
    subtitle: { fontSize: 13, color: colors.text.secondary, marginTop: 6, marginBottom: 12 },
    empty: { alignItems: 'center', paddingVertical: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text.primary },
    emptyDesc: { fontSize: 13, color: colors.text.secondary, marginTop: 4 },
    card: {
      backgroundColor: colors.background.secondary,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    versionLabel: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
    currentBadge: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.status.success,
      borderWidth: 1,
      borderColor: colors.status.success,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    versionSubject: { fontSize: 14, color: colors.text.primary, marginTop: 8 },
    versionMeta: { fontSize: 12, color: colors.text.secondary, marginTop: 4 },
    rollbackButton: {
      marginTop: 10,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    rollbackText: { color: colors.brand.primary, fontWeight: '600' },
  });
}

export default TemplateVersionHistoryScreen;
