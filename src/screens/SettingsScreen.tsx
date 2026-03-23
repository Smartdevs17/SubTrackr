import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Switch, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useWalletStore } from '../store';
import { Card } from '../components/common/Card';

const APP_VERSION = '1.0.0';
interface Settings { notificationsEnabled: boolean; defaultCurrency: string; }
const SETTINGS_KEY = '@subtrackr_settings';

const SettingsScreen: React.FC = () => {
  const { address, network, disconnect } = useWalletStore();
  const [settings, setSettings] = useState<Settings>({ notificationsEnabled: true, defaultCurrency: 'USD' });

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await AsyncStorage.getItem(SETTINGS_KEY);
      if (savedSettings) setSettings(JSON.parse(savedSettings));
    } catch (error) { console.error('Failed to load settings:', error); }
  };

  const saveSettings = async (newSettings: Settings) => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) { console.error('Failed to save settings:', error); }
  };

  const handleNotificationToggle = useCallback((value: boolean) => saveSettings({ ...settings, notificationsEnabled: value }), [settings]);
  const handleCurrencyChange = useCallback((currency: string) => saveSettings({ ...settings, defaultCurrency: currency }), [settings]);

  const handleDisconnectWallet = useCallback(() => {
    Alert.alert('Disconnect Wallet', 'Are you sure you want to disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try { await disconnect(); Alert.alert('Success', 'Wallet disconnected'); }
        catch { Alert.alert('Error', 'Failed to disconnect wallet'); }
      }},
    ]);
  }, [disconnect]);

  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
  const shortenAddress = (addr: string): string => !addr ? 'Not connected' : `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}><Text style={styles.title}>Settings</Text><Text style={styles.subtitle}>Configure your preferences</Text></View>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Wallet Address</Text><Text style={styles.settingValue}>{shortenAddress(address || '')}</Text></View>
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Network</Text><Text style={styles.settingValue}>{network || 'Not connected'}</Text></View>
          </View>
          {address && <TouchableOpacity style={styles.dangerButton} onPress={handleDisconnectWallet}><Text style={styles.dangerButtonText}>Disconnect Wallet</Text></TouchableOpacity>}
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Billing Reminders</Text><Text style={styles.settingDescription}>Get notified before subscriptions renew</Text></View>
            <Switch value={settings.notificationsEnabled} onValueChange={handleNotificationToggle} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.text} />
          </View>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}><Text style={styles.settingLabel}>Default Currency</Text><Text style={styles.settingDescription}>Currency for new subscriptions</Text></View>
          </View>
          <View style={styles.currencyGrid}>
            {currencies.map((currency) => (
              <TouchableOpacity key={currency} style={[styles.currencyButton, settings.defaultCurrency === currency && styles.currencyButtonActive]} onPress={() => handleCurrencyChange(currency)}>
                <Text style={[styles.currencyButtonText, settings.defaultCurrency === currency && styles.currencyButtonTextActive]}>{currency}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.settingRow}><Text style={styles.settingLabel}>Version</Text><Text style={styles.settingValue}>{APP_VERSION}</Text></View>
          <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL('mailto:support@subtrackr.app')}><Text style={styles.linkText}>Contact Support</Text><Text style={styles.linkArrow}>→</Text></TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL('https://subtrackr.app/privacy')}><Text style={styles.linkText}>Privacy Policy</Text><Text style={styles.linkArrow}>→</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.linkRowLast]} onPress={() => Linking.openURL('https://subtrackr.app/terms')}><Text style={styles.linkText}>Terms of Service</Text><Text style={styles.linkArrow}>→</Text></TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md }, title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs }, subtitle: { ...typography.body, color: colors.textSecondary },
  section: { marginHorizontal: spacing.lg, marginBottom: spacing.md }, sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingInfo: { flex: 1 }, settingLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  settingValue: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs }, settingDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  dangerButton: { backgroundColor: colors.error + '20', padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.md },
  dangerButtonText: { ...typography.body, color: colors.error, fontWeight: '600' },
  currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  currencyButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  currencyButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  currencyButtonText: { ...typography.body, color: colors.text }, currencyButtonTextActive: { color: colors.text, fontWeight: '600' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  linkRowLast: { borderBottomWidth: 0 }, linkText: { ...typography.body, color: colors.text }, linkArrow: { ...typography.body, color: colors.textSecondary },
});

export default SettingsScreen;
