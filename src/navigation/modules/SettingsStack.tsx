import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const SettingsScreen = lazyScreen(() => import('../../screens/SettingsScreen'));
const LanguageSettingsScreen = lazyScreen(() => import('../../screens/LanguageSettingsScreen'));
const NotificationPreferencesScreen = lazyScreen(
  () => import('../../screens/NotificationPreferencesScreen')
);
const EmailTemplateEditorScreen = lazyScreen(
  () => import('../../screens/EmailTemplateEditorScreen')
);
const GDPRSettingsScreen = lazyScreen(() => import('../../screens/GDPRSettingsScreen'));
const PrivacyCenterScreen = lazyScreen(() => import('../../screens/PrivacyCenterScreen'));
const DataExportScreen = lazyScreen(() => import('../../screens/DataExportScreen'));
const TaxSettingsScreen = lazyScreen(() => import('../../screens/TaxSettingsScreen'));
const TaxComplianceScreen = lazyScreen(() => import('../../screens/TaxComplianceScreen'));

export const SettingsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="LanguageSettings"
      component={LanguageSettingsScreen}
      options={{ title: 'Language', headerShown: true }}
    />
    <Stack.Screen
      name="NotificationPreferences"
      component={NotificationPreferencesScreen}
      options={{ title: 'Notification Preferences', headerShown: true }}
    />
    <Stack.Screen
      name="EmailTemplateEditor"
      component={EmailTemplateEditorScreen}
      options={{ title: 'Email Template Editor', headerShown: true }}
    />
    <Stack.Screen
      name="GDPRSettings"
      component={GDPRSettingsScreen}
      options={{ title: 'Privacy Settings', headerShown: true }}
    />
    <Stack.Screen
      name="PrivacyCenter"
      component={PrivacyCenterScreen}
      options={{ title: 'Privacy Center', headerShown: true }}
    />
    <Stack.Screen
      name="DataExport"
      component={DataExportScreen}
      options={{ title: 'Export My Data', headerShown: true }}
    />
    <Stack.Screen
      name="DPALog"
      component={DataExportScreen}
      options={{ title: 'Data Processing Log', headerShown: true }}
    />
    <Stack.Screen
      name="TaxSettings"
      component={TaxSettingsScreen}
      options={{ title: 'Tax Settings', headerShown: true }}
    />
    <Stack.Screen
      name="TaxCompliance"
      component={TaxComplianceScreen}
      options={{ title: 'Tax Compliance', headerShown: true }}
    />
  </Stack.Navigator>
);
