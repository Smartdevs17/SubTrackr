import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const DeveloperPortalScreen = lazyScreen(() => import('../../screens/DeveloperPortalScreen'));
const SandboxDashboardScreen = lazyScreen(() => import('../../screens/SandboxDashboardScreen'));
const ApiKeyManagementScreen = lazyScreen(() => import('../../screens/ApiKeyManagementScreen'));
const DocumentationPortalScreen = lazyScreen(
  () => import('../../screens/DocumentationPortalScreen')
);
const IntegrationGuidesScreen = lazyScreen(() => import('../../screens/IntegrationGuidesScreen'));
const WebhookSettingsScreen = lazyScreen(() => import('../../screens/WebhookSettingsScreen'));
const WebhookLogsScreen = lazyScreen(() => import('../../screens/WebhookLogsScreen'));
const ImportScreen = lazyScreen(() => import('../../screens/ImportScreen'));
const ExportScreen = lazyScreen(() => import('../../screens/ExportScreen'));
const BatchOperationsScreen = lazyScreen(() =>
  import('../../../app/screens/BatchOperationsScreen').then((m) => ({
    default: m.BatchOperationsScreen,
  }))
);
const AccountingExportScreen = lazyScreen(() => import('../../screens/AccountingExportScreen'));

export const DeveloperStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="DeveloperPortal"
      component={DeveloperPortalScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SandboxDashboard"
      component={SandboxDashboardScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="ApiKeyManagement"
      component={ApiKeyManagementScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="DocumentationPortal"
      component={DocumentationPortalScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="IntegrationGuides"
      component={IntegrationGuidesScreen}
      options={{ title: 'Integrations', headerShown: true }}
    />
    <Stack.Screen
      name="WebhookSettings"
      component={WebhookSettingsScreen}
      options={{ title: 'Webhooks', headerShown: true }}
    />
    <Stack.Screen
      name="WebhookLogs"
      component={WebhookLogsScreen}
      options={{ title: 'Delivery Logs', headerShown: true }}
    />
    <Stack.Screen
      name="Import"
      component={ImportScreen}
      options={{ title: 'Import Subscriptions', headerShown: true }}
    />
    <Stack.Screen
      name="Export"
      component={ExportScreen}
      options={{ title: 'Export Subscriptions', headerShown: true }}
    />
    <Stack.Screen
      name="BatchOperations"
      component={BatchOperationsScreen}
      options={{ title: 'Batch Operations', headerShown: true }}
    />
    <Stack.Screen
      name="AccountingExport"
      component={AccountingExportScreen}
      options={{ title: 'Accounting Export', headerShown: true }}
    />
  </Stack.Navigator>
);
