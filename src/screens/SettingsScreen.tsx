import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Modal,
  FlatList,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useWalletStore, useNetworkStore, useSettingsStore } from '../store';

import { Card } from '../components/common/Card';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTranslation } from 'react-i18next';

const APP_VERSION = '1.0.0';

const SettingsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { address, disconnect } = useWalletStore();
  const { currentNetwork, availableNetworks, setNetwork, initialize } = useNetworkStore();
  const { preferredCurrency, notificationsEnabled, setPreferredCurrency, setNotificationsEnabled } =
    useSettingsStore();

  const [networkModalVisible, setNetworkModalVisible] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleNotificationToggle = useCallback(
    (value: boolean) => setNotificationsEnabled(value),
    [setNotificationsEnabled]
  );

  const handleCurrencyChange = useCallback(
    (currency: string) => setPreferredCurrency(currency),
    [setPreferredCurrency]
  );

  const handleDisconnectWallet = useCallback(() => {
    Alert.alert(t('settings.disconnect_wallet'), t('settings.disconnect_wallet_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnect();
            Alert.alert(t('common.success'), t('settings.wallet_disconnected'));
          } catch {
            Alert.alert(t('common.error'), t('settings.wallet_disconnect_failed'));
          }
        },
      },
    ]);
  }, [disconnect, t]);

  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
  const shortenAddress = (addr: string): string =>
    !addr ? 'Not connected' : `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t('settings.sections.account')}
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{t('settings.wallet_address')}</Text>
              <Text style={styles.settingValue}>{shortenAddress(address || '')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => setNetworkModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.select_network')}
            accessibilityHint={t('settings.select_network_hint')}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{t('settings.network')}</Text>
              <Text style={styles.settingValue}>
                {currentNetwork ? currentNetwork.name : t('settings.select_network')}
              </Text>
            </View>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          {address && (
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDisconnectWallet}
              accessibilityRole="button"
              accessibilityLabel={t('settings.disconnect_wallet')}
              accessibilityHint={t('settings.disconnect_wallet_hint')}>
              <Text style={styles.dangerButtonText}>{t('settings.disconnect_wallet')}</Text>
            </TouchableOpacity>
          )}
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t('settings.sections.notifications')}
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{t('settings.billing_reminders')}</Text>
              <Text style={styles.settingDescription}>{t('settings.billing_reminders_desc')}</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
              accessibilityLabel={t('settings.billing_reminders')}
              accessibilityRole="switch"
              accessibilityState={{ checked: notificationsEnabled }}
            />
          </View>
          <TouchableOpacity
            style={[styles.linkRow, styles.linkRowLast]}
            onPress={() => navigation.navigate('CalendarIntegration')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.calendar_sync')}
            accessibilityHint={t('settings.calendar_sync_hint')}>
            <Text style={styles.linkText}>{t('settings.calendar_sync')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              {'>'}
            </Text>
          </TouchableOpacity>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t('settings.sections.preferences')}
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{t('settings.default_currency')}</Text>
              <Text style={styles.settingDescription}>{t('settings.default_currency_desc')}</Text>
            </View>
          </View>
          <View style={styles.currencyGrid}>
            {currencies.map((currency) => (
              <TouchableOpacity
                key={currency}
                style={[
                  styles.currencyButton,
                  preferredCurrency === currency && styles.currencyButtonActive,
                ]}
                onPress={() => handleCurrencyChange(currency)}
                accessibilityRole="radio"
                accessibilityLabel={currency}
                accessibilityState={{ checked: preferredCurrency === currency }}>
                <Text
                  style={[
                    styles.currencyButtonText,
                    preferredCurrency === currency && styles.currencyButtonTextActive,
                  ]}>
                  {currency}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Data Management
          </Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Import')}
            accessibilityRole="button"
            accessibilityLabel="Import subscriptions"
            accessibilityHint="Opens import screen">
            <Text style={styles.linkText}>Import Subscriptions</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Export')}
            accessibilityRole="button"
            accessibilityLabel="Export subscriptions"
            accessibilityHint="Opens export screen">
            <Text style={styles.linkText}>Export Subscriptions</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Merchant & Affiliate
          </Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('MerchantOnboarding')}
            accessibilityRole="button"
            accessibilityLabel="Merchant onboarding">
            <Text style={styles.linkText}>Merchant Onboarding</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('AffiliateDashboard')}
            accessibilityRole="button"
            accessibilityLabel="Affiliate dashboard">
            <Text style={styles.linkText}>Affiliate Dashboard</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('LoyaltyDashboard')}
            accessibilityRole="button"
            accessibilityLabel="Loyalty dashboard">
            <Text style={styles.linkText}>Loyalty Dashboard</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkRow, styles.linkRowLast]}
            onPress={() => navigation.navigate('CampaignManagement')}
            accessibilityRole="button"
            accessibilityLabel="Campaign management">
            <Text style={styles.linkText}>Campaign Management</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
        </Card>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            About
          </Text>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t('settings.sections.about')}
          </Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.version')}</Text>
            <Text style={styles.settingValue}>{APP_VERSION}</Text>
          </View>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL('mailto:support@subtrackr.app')}
            accessibilityRole="link"
            accessibilityLabel={t('settings.contact_support')}
            accessibilityHint={t('settings.contact_support_hint')}>
            <Text style={styles.linkText}>{t('settings.contact_support')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Community')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.community')}
            accessibilityHint={t('settings.community_hint')}>
            <Text style={styles.linkText}>{t('settings.community')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              &gt;
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('AccountingExport')}
            accessibilityRole="button"
            accessibilityLabel="Accounting export"
            accessibilityHint="Opens QuickBooks and Xero subscription export settings">
            <Text style={styles.linkText}>Accounting Export</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              &gt;
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('WebhookSettings')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.webhooks')}
            accessibilityHint={t('settings.webhooks_hint')}>
            <Text style={styles.linkText}>{t('settings.webhooks')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('AdminDashboard')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.admin_dashboard')}
            accessibilityHint={t('settings.admin_dashboard_hint')}>
            <Text style={styles.linkText}>{t('settings.admin_dashboard')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('SlaDashboard')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.sla_dashboard')}
            accessibilityHint={t('settings.sla_dashboard_hint')}>
            <Text style={styles.linkText}>{t('settings.sla_dashboard')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('FraudDashboard')}
            accessibilityRole="button"
            accessibilityLabel="Fraud dashboard"
            accessibilityHint="Opens fraud monitoring and manual review controls">
            <Text style={styles.linkText}>Fraud Dashboard</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('LanguageSettings')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.language')}
            accessibilityHint={t('settings.language_hint')}>
            <Text style={styles.linkText}>{t('settings.language')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('SessionManagement')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.session_management')}
            accessibilityHint={t('settings.session_management_hint')}>
            <Text style={styles.linkText}>{t('settings.session_management')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          {__DEV__ && (
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => navigation.navigate('ErrorDashboard')}>
              <Text style={styles.linkText}>{t('settings.error_dashboard')}</Text>
              <Text style={styles.linkArrow}>→</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://subtrackr.app/privacy')}
            accessibilityRole="link"
            accessibilityLabel={t('settings.privacy_policy')}
            accessibilityHint={t('settings.privacy_policy_hint')}>
            <Text style={styles.linkText}>{t('settings.privacy_policy')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkRow, styles.linkRowLast]}
            onPress={() => Linking.openURL('https://subtrackr.app/terms')}
            accessibilityRole="link"
            accessibilityLabel={t('settings.terms_of_service')}
            accessibilityHint={t('settings.terms_of_service_hint')}>
            <Text style={styles.linkText}>{t('settings.terms_of_service')}</Text>
            <Text style={styles.linkArrow} accessibilityElementsHidden={true}>
              →
            </Text>
          </TouchableOpacity>
        </Card>

        {/* Network Selection Modal */}
        <Modal
          visible={networkModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setNetworkModalVisible(false)}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => setNetworkModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.close_network_selection')}>
                <Text style={styles.closeButton}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t('settings.select_network')}</Text>
              <View style={{ width: 50 }} />
            </View>
            <FlatList
              data={availableNetworks}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.networkItem,
                    currentNetwork?.id === item.id && styles.networkItemSelected,
                  ]}
                  onPress={async () => {
                    await setNetwork(item.id);
                    setNetworkModalVisible(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={t('settings.select_network_item', { name: item.name })}
                  accessibilityState={{ checked: currentNetwork?.id === item.id }}>
                  <View style={styles.networkInfo}>
                    <Text style={styles.networkName}>{item.name}</Text>
                    <Text style={styles.networkType}>
                      {item.type.toUpperCase()}{' '}
                      {item.isTestnet ? t('settings.testnet') : t('settings.mainnet')}
                    </Text>
                  </View>
                  {currentNetwork?.id === item.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </Modal>
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
  section: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingInfo: { flex: 1 },
  settingLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  settingValue: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  settingDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  dangerButton: {
    backgroundColor: colors.error + '20',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  dangerButtonText: { ...typography.body, color: colors.error, fontWeight: '600' },
  currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  currencyButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currencyButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  currencyButtonText: { ...typography.body, color: colors.text },
  currencyButtonTextActive: { color: colors.text, fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkRowLast: { borderBottomWidth: 0 },
  linkText: { ...typography.body, color: colors.text },
  linkArrow: { ...typography.body, color: colors.textSecondary },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.h2, color: colors.text },
  closeButton: { ...typography.body, color: colors.primary },
  networkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  networkItemSelected: { backgroundColor: colors.primary + '10' },
  networkInfo: { flex: 1 },
  networkName: { ...typography.body, color: colors.text, fontWeight: '600' },
  networkType: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  checkmark: { ...typography.h3, color: colors.primary },
});

export default SettingsScreen;
