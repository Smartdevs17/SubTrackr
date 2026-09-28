import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useThemeColors } from '../hooks/useThemeColors';
import { gdprService } from '../services/gdpr';
import { useUserStore } from '../store/userStore';
import { CONSENT_CATEGORIES } from '../services/consentService';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PrivacyCenterScreen = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const { consent } = useUserStore();
  const [loading, setLoading] = useState(false);

  const handleRequestDeletion = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data after a 30-day retention period. Active subscriptions must be cancelled first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request Deletion',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const result = await gdprService.requestDeletion(true);
              if (!result.success) {
                Alert.alert('Blocked', result.message);
              } else {
                Alert.alert('Deletion Requested', result.message);
              }
            } catch {
              Alert.alert('Error', 'Deletion request failed. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Privacy Center screen">
      <Text style={styles.title}>Privacy Center</Text>
      <Text style={styles.subtitle}>
        Manage your data rights, consent preferences, and access GDPR tools.
      </Text>

      {/* Consent Management */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Consent Management</Text>
        {CONSENT_CATEGORIES.map((item) => (
          <View key={item.key} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{item.title}</Text>
              <Text style={styles.rowMeta}>
                Status: {consent[item.key] ? '✅ Granted' : '❌ Withdrawn'}
              </Text>
            </View>
          </View>
        ))}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('ConsentManagement')}
          testID="privacy-center-manage-consent"
          accessibilityRole="button"
          accessibilityLabel="Manage consent preferences">
          <Text style={styles.actionBtnIcon}>🛡️</Text>
          <View style={styles.actionBtnText}>
            <Text style={styles.actionBtnTitle}>Manage Consent</Text>
            <Text style={styles.actionBtnDesc}>Grant or withdraw consent and view history</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Data Rights */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Data Rights</Text>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('DataExport')}
          accessibilityRole="button"
          accessibilityLabel="Export my data">
          <Text style={styles.actionBtnIcon}>📦</Text>
          <View style={styles.actionBtnText}>
            <Text style={styles.actionBtnTitle}>Export My Data</Text>
            <Text style={styles.actionBtnDesc}>Download all your personal data as JSON (SAR)</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('DPALog')}
          accessibilityRole="button"
          accessibilityLabel="View data processing log">
          <Text style={styles.actionBtnIcon}>📋</Text>
          <View style={styles.actionBtnText}>
            <Text style={styles.actionBtnTitle}>Data Processing Log</Text>
            <Text style={styles.actionBtnDesc}>See how and when your data has been processed</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.dangerBtn]}
          onPress={handleRequestDeletion}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Request account deletion"
          accessibilityState={{ disabled: loading, busy: loading }}>
          {loading ? (
            <ActivityIndicator color={colors.error} style={styles.actionBtnIcon} />
          ) : (
            <Text style={styles.actionBtnIcon}>🗑️</Text>
          )}
          <View style={styles.actionBtnText}>
            <Text style={[styles.actionBtnTitle, styles.dangerText]}>Delete My Account</Text>
            <Text style={styles.actionBtnDesc}>
              Right to erasure — cascade delete all your data
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        SubTrackr is GDPR compliant. Data is processed under the legal basis of contract and
        legitimate interest. See our Privacy Policy for details.
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
    rowText: { flex: 1 },
    rowLabel: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    rowMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
    toggleActive: { backgroundColor: colors.error + '22' },
    toggleInactive: { backgroundColor: colors.primary + '22' },
    toggleBtnText: { fontSize: 13, fontWeight: '600', color: colors.text.primary },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    dangerBtn: { borderBottomWidth: 0 },
    actionBtnIcon: { fontSize: 20, marginRight: 12 },
    actionBtnText: { flex: 1 },
    actionBtnTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    actionBtnDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    dangerText: { color: colors.error },
    chevron: { fontSize: 20, color: colors.textSecondary },
    footer: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  });
}

export default PrivacyCenterScreen;
