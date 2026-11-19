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
import { useUserStore } from '../store/userStore';
import { gdprService } from '../services/gdpr';
import { useThemeColors } from '../hooks/useThemeColors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const GDPRSettingsScreen = () => {
  const navigation = useNavigation<Nav>();
  const { consent } = useUserStore();
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await gdprService.exportData();
      gdprService.downloadData(result);
    } catch (error) {
      Alert.alert('Error', 'Could not prepare your data export. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Permanent Deletion',
      'Are you sure you want to delete your account? This action will anonymize your data and revoke access to all subscriptions. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await gdprService.requestDeletion(true);
              Alert.alert('Success', 'Your account has been queued for deletion.');
            } catch (e) {
              Alert.alert('Error', 'Deletion failed.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy & Consent</Text>
        <Text style={styles.description}>
          Manage how SubTrackr processes your data and what notifications you receive.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('ConsentManagement')}
          testID="gdpr-manage-consent"
          accessibilityRole="button"
          accessibilityLabel="Manage consent preferences"
          accessibilityHint="Grant or withdraw consent for analytics, marketing, and notifications">
          <Text style={styles.buttonText}>Manage Consent Preferences</Text>
        </TouchableOpacity>
        <Text style={styles.infoText}>
          Analytics: {consent.analytics ? 'On' : 'Off'} · Marketing:{' '}
          {consent.marketing ? 'On' : 'Off'} · Notifications: {consent.notifications ? 'On' : 'Off'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Data Rights</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleExport}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Export my data as JSON"
          accessibilityHint="Downloads a copy of your profile, subscriptions, and billing history"
          accessibilityState={{ disabled: loading, busy: loading }}>
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Export My Data (JSON)</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.infoText}>
          Download a structured copy of your profile, subscriptions, and billing history.
        </Text>

        <TouchableOpacity
          style={[styles.button, styles.deleteButton]}
          onPress={handleDeleteAccount}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          accessibilityHint="Permanently anonymizes your personal data. This cannot be undone."
          accessibilityState={{ disabled: loading }}>
          <Text style={styles.buttonText}>Delete My Account</Text>
        </TouchableOpacity>
        <Text style={styles.infoText}>
          Exercise your "Right to be Forgotten". This will anonymize your personal information.
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          SubTrackr stores your data on-chain via Stellar and encrypted in our secure databases. For
          more information, see our Privacy Policy.
        </Text>
      </View>
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background.primary,
    },
    section: {
      padding: 20,
      backgroundColor: colors.background.card,
      marginBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text.primary,
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 20,
      lineHeight: 20,
    },
    button: {
      backgroundColor: colors.primary,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 10,
    },
    deleteButton: {
      backgroundColor: colors.error,
      marginTop: 30,
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    infoText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
    },
    footer: {
      padding: 30,
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
}

export default GDPRSettingsScreen;
