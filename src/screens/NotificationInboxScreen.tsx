/**
 * In-app notification inbox (#1750)
 *
 * The screen behind the bell: a persistent, read/unread-aware feed of every
 * notification delivered on any channel. It renders directly from
 * `notificationCenterStore`, which persists the feed on device, so history
 * survives relaunches and the unread badge is accurate on first paint.
 *
 * Behaviour worth stating:
 *
 *  - **Tapping an entry reads and records the click** — the store's
 *    `markClicked` implies a read, so engagement never reports "clicked but
 *    never opened".
 *  - **Dismissing hides without deleting** — a dismissed entry leaves the feed
 *    but still counts in analytics, keeping "the subscriber ignored it"
 *    distinguishable from "it was never delivered".
 *  - **Filters compose with grouping** — unread/important/type chips narrow the
 *    feed first; day/type sections are built over what survives.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  useNotificationCenterStore,
  type InboxEntry,
  type InboxFilter,
} from '../store/notificationCenterStore';
import type { NotificationType } from '../types/notification';

type QuickFilter = 'all' | 'unreadOnly' | 'importantOnly';

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreadOnly', label: 'Unread' },
  { key: 'importantOnly', label: 'Important' },
];

function filterFromQuick(quick: QuickFilter, type?: NotificationType): InboxFilter {
  const filter: InboxFilter = {};
  if (quick === 'unreadOnly') filter.unreadOnly = true;
  if (quick === 'importantOnly') filter.importantOnly = true;
  if (type) filter.type = type;
  return filter;
}

const NotificationInboxScreen = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const entries = useNotificationCenterStore((s) => s.entries);
  const grouping = useNotificationCenterStore((s) => s.grouping);
  const timezone = useNotificationCenterStore((s) => s.timezone);
  const sections = useNotificationCenterStore((s) => s.getSections);
  const badge = useNotificationCenterStore((s) => s.getBadge);
  const categories = useNotificationCenterStore((s) => s.getCategories);
  const markClicked = useNotificationCenterStore((s) => s.markClicked);
  const markAllRead = useNotificationCenterStore((s) => s.markAllRead);
  const dismiss = useNotificationCenterStore((s) => s.dismiss);

  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>('all');
  const [typeFilter, setTypeFilter] = React.useState<NotificationType | undefined>(undefined);

  const filter = React.useMemo(
    () => filterFromQuick(quickFilter, typeFilter),
    [quickFilter, typeFilter]
  );
  const visibleSections = React.useMemo(
    () => sections(filter),
    // `sections` reads live store state; recompute when the filter or the
    // feed itself changes.
    [sections, filter, entries, grouping, timezone]
  );
  const counts = React.useMemo(() => badge(), [badge, entries]);
  const chips = React.useMemo(() => categories(), [categories, entries]);

  const openEntry = React.useCallback(
    (entry: InboxEntry) => {
      markClicked(entry.id);
    },
    [markClicked]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Notification inbox screen">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Inbox</Text>
        {counts.unread > 0 && (
          <View
            style={styles.badge}
            testID="inbox-unread-badge"
            accessibilityLabel={`${counts.unread} unread notifications`}>
            <Text style={styles.badgeText}>{counts.label}</Text>
          </View>
        )}
      </View>
      <Text style={styles.subtitle}>
        Every notification we have sent you, on every channel. Tap to open, swipe-free dismiss with
        the ✕.
      </Text>

      {counts.unread > 0 && (
        <TouchableOpacity
          style={styles.markAllRow}
          onPress={() => markAllRead()}
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications read"
          testID="inbox-mark-all-read">
          <Text style={styles.markAllText}>Mark all {counts.unread} unread as read</Text>
        </TouchableOpacity>
      )}

      {/* Quick filters */}
      <View style={styles.chipRow} testID="inbox-quick-filters">
        {QUICK_FILTERS.map((option) => {
          const active = quickFilter === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setQuickFilter(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter: ${option.label}`}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Type chips */}
      {chips.length > 0 && (
        <View style={styles.chipRow} testID="inbox-type-filters">
          {chips.map(({ type, label, count }) => {
            const active = typeFilter === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.chip, styles.chipSmall, active && styles.chipActive]}
                onPress={() => setTypeFilter(active ? undefined : type)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter by ${label}`}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {visibleSections.length === 0 ? (
        <View style={styles.empty} testID="inbox-empty">
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptyDesc}>
            {entries.length === 0
              ? 'Notifications delivered to any channel will show up here.'
              : 'Nothing matches the current filters.'}
          </Text>
        </View>
      ) : (
        visibleSections.map((section) => (
          <View key={section.key} style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.cardTitle}>{section.heading}</Text>
              {section.unreadCount > 0 && (
                <Text style={styles.sectionUnread}>{section.unreadCount} unread</Text>
              )}
            </View>
            {section.entries.map((entry) => (
              <View key={entry.id} style={styles.entryRow}>
                <TouchableOpacity
                  style={styles.entryMain}
                  onPress={() => openEntry(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.title}, ${entry.readAt ? 'read' : 'unread'}, ${entry.label}`}>
                  <View style={styles.entryText}>
                    <Text style={[styles.entryTitle, !entry.readAt && styles.unreadLabel]}>
                      {entry.title}
                    </Text>
                    <Text style={styles.entryBody} numberOfLines={3}>
                      {entry.body}
                    </Text>
                    <Text style={styles.entryMeta}>
                      {entry.label}
                      {' · '}
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {entry.important ? ' · Important' : ''}
                    </Text>
                  </View>
                  {!entry.readAt && (
                    <View
                      style={styles.unreadDot}
                      testID={`inbox-unread-dot-${entry.id}`}
                      accessibilityLabel="Unread"
                    />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => dismiss(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Dismiss ${entry.title}`}
                  testID={`inbox-dismiss-${entry.id}`}
                  style={styles.dismissButton}>
                  <Text style={styles.dismissText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { fontSize: 24, fontWeight: '700', color: colors.text.primary, marginRight: 10 },
    badge: {
      minWidth: 26,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 7,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 16,
      lineHeight: 20,
    },
    markAllRow: { marginBottom: 12 },
    markAllText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    chipSmall: { paddingHorizontal: 10, paddingVertical: 5 },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.text.primary },
    chipTextActive: { color: '#fff', fontWeight: '600' },
    card: {
      backgroundColor: colors.background.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
    sectionUnread: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    entryMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    entryText: { flex: 1, paddingRight: 8 },
    entryTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    entryBody: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
    entryMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    unreadLabel: { color: colors.primary },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    dismissButton: { paddingLeft: 10, paddingVertical: 8 },
    dismissText: { fontSize: 14, color: colors.textSecondary },
    empty: { alignItems: 'center', paddingVertical: 40 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginBottom: 6 },
    emptyDesc: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  });
}

export default NotificationInboxScreen;
