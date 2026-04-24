import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { sessionService, SessionRecord, SessionSettings } from '../services/auth/session';
import { Card } from '../components/common/Card';

const timeoutOptions = [5, 15, 30, 60, 120];

const formatDateTime = (timestamp: number) => new Date(timestamp).toLocaleString();

const SessionManagementScreen: React.FC = () => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [settings, setSettings] = useState<SessionSettings>({ timeoutMinutes: 30 });

  const refresh = useCallback(async () => {
    const [resolvedSettings] = await Promise.all([
      sessionService.getSettings(),
      sessionService.initializeCurrentSession(),
      sessionService.detectSuspiciousSessions(),
    ]);
    setSettings(resolvedSettings);
    const latest = await sessionService.getSessions();
    setSessions(latest);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeSessions = useMemo(() => sessions.filter((session) => !session.revokedAt), [sessions]);
  const currentSession = useMemo(() => activeSessions.find((session) => session.isCurrent), [activeSessions]);

  const handleTimeoutChange = async (minutes: number) => {
    const updated = await sessionService.updateSettings({ timeoutMinutes: minutes });
    setSettings(updated);
    await refresh();
  };

  const handleRevoke = (session: SessionRecord) => {
    Alert.alert('Revoke Session', `Revoke session on ${session.deviceName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          await sessionService.revokeSession(session.id);
          await refresh();
        },
      },
    ]);
  };

  const handleForceLogoutOthers = async () => {
    if (!currentSession) return;
    await sessionService.revokeOtherSessions(currentSession.id);
    await refresh();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Session Management</Text>
          <Text style={styles.subtitle}>Control active sessions and security policies</Text>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Session Timeout</Text>
          <View style={styles.rowWrap}>
            {timeoutOptions.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={[
                  styles.timeoutChip,
                  settings.timeoutMinutes === minutes && styles.timeoutChipActive,
                ]}
                onPress={() => void handleTimeoutChange(minutes)}>
                <Text
                  style={[
                    styles.timeoutChipText,
                    settings.timeoutMinutes === minutes && styles.timeoutChipTextActive,
                  ]}>
                  {minutes}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Concurrent Sessions ({activeSessions.length})</Text>
          {activeSessions.map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionName}>
                  {session.deviceName} {session.isCurrent ? '(Current)' : ''}
                </Text>
                <Text style={styles.sessionMeta}>Last active: {formatDateTime(session.lastActiveAt)}</Text>
                {session.suspicious && <Text style={styles.suspiciousText}>Suspicious: {session.reason}</Text>}
              </View>
              {!session.isCurrent && (
                <TouchableOpacity style={styles.revokeButton} onPress={() => handleRevoke(session)}>
                  <Text style={styles.revokeButtonText}>Revoke</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.forceLogoutButton} onPress={() => void handleForceLogoutOthers()}>
            <Text style={styles.forceLogoutText}>Force Logout Other Sessions</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeoutChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  timeoutChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timeoutChipText: { ...typography.body, color: colors.text },
  timeoutChipTextActive: { color: colors.text, fontWeight: '700' },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionName: { ...typography.body, color: colors.text, fontWeight: '600' },
  sessionMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  suspiciousText: { ...typography.caption, color: colors.error, marginTop: spacing.xs },
  revokeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.error + '20',
    borderRadius: borderRadius.md,
  },
  revokeButtonText: { ...typography.caption, color: colors.error, fontWeight: '700' },
  forceLogoutButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  forceLogoutText: { ...typography.body, color: colors.text, fontWeight: '700' },
});

export default SessionManagementScreen;
