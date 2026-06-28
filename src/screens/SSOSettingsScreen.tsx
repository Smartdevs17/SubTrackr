import React, { useState, useCallback } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Card } from '../components/common/Card';
import { useSSOStore } from '../store/ssoStore';
import {
  AVAILABLE_ROLES,
  SSO_PROVIDER_PRESETS,
  type IdentityProvider,
  type SSOProtocol,
  type SubTrackrRole,
} from '../types/sso';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

const statusColors: Record<string, string> = {
  active: '#22c55e',
  inactive: '#ef4444',
  pending_setup: '#f59e0b',
};

const protocolLabels: Record<SSOProtocol, string> = {
  saml2: 'SAML 2.0',
  oidc: 'OpenID Connect',
};

const roleLabels: Record<SubTrackrRole, string> = {
  admin: 'Admin',
  viewer: 'Viewer',
  billing: 'Billing',
};

const SSOSettingsScreen: React.FC = () => {
  const {
    providers,
    scimUsers,
    error,
    addProvider,
    removeProvider,
    activateProvider,
    deactivateProvider,
    setRoleMappings,
    toggleJIT,
    uploadMetadata,
    deactivateSCIMUser,
    clearError,
  } = useSSOStore();

  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderProtocol, setNewProviderProtocol] = useState<SSOProtocol>('saml2');
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupRole, setNewGroupRole] = useState<SubTrackrRole>('viewer');

  const handleAddProvider = useCallback(() => {
    if (!newProviderName.trim()) {
      Alert.alert('Validation', 'Provider name is required.');
      return;
    }
    addProvider('org_default', newProviderName.trim(), newProviderProtocol);
    setNewProviderName('');
    setShowAddProvider(false);
    Alert.alert('Provider Added', `${newProviderName} has been added. Configure it to activate.`);
  }, [newProviderName, newProviderProtocol, addProvider]);

  const handleRemoveProvider = useCallback(
    (provider: IdentityProvider) => {
      Alert.alert(
        'Remove Provider',
        `Remove ${provider.name}? All SSO sessions through this provider will be terminated.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeProvider(provider.id),
          },
        ]
      );
    },
    [removeProvider]
  );

  const handleUploadMetadata = useCallback(
    (provider: IdentityProvider) => {
      const sampleXml =
        `<md:EntityDescriptor entityID="https://${provider.name.toLowerCase().replace(/\s/g, '')}.example.com">` +
        `<md:IDPSSODescriptor><md:SingleSignOnService Location="https://${provider.name.toLowerCase().replace(/\s/g, '')}.example.com/sso"/>` +
        `</md:IDPSSODescriptor></md:EntityDescriptor>`;

      uploadMetadata(provider.id, sampleXml);
      Alert.alert('Metadata Uploaded', `${provider.name} SAML metadata has been configured.`);
    },
    [uploadMetadata]
  );

  const handleAddRoleMapping = useCallback(
    (provider: IdentityProvider) => {
      if (!newGroupName.trim()) {
        Alert.alert('Validation', 'Group name is required.');
        return;
      }
      const updated = [
        ...provider.roleMappings,
        { idpGroup: newGroupName.trim(), subtrackrRole: newGroupRole },
      ];
      setRoleMappings(provider.id, updated);
      setNewGroupName('');
    },
    [newGroupName, newGroupRole, setRoleMappings]
  );

  const handleRemoveRoleMapping = useCallback(
    (provider: IdentityProvider, index: number) => {
      const updated = provider.roleMappings.filter((_, i) => i !== index);
      setRoleMappings(provider.id, updated);
    },
    [setRoleMappings]
  );

  const renderProviderCard = (provider: IdentityProvider) => {
    const isExpanded = expandedProviderId === provider.id;
    const providerUsers = scimUsers.filter((u) => u.status === 'active');

    return (
      <Card key={provider.id} style={styles.card}>
        <TouchableOpacity
          onPress={() => setExpandedProviderId(isExpanded ? null : provider.id)}
          style={styles.cardHeader}>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>{provider.name}</Text>
            <View style={styles.badges}>
              <View
                style={[styles.badge, { backgroundColor: statusColors[provider.status] + '20' }]}>
                <Text style={[styles.badgeText, { color: statusColors[provider.status] }]}>
                  {provider.status.replace('_', ' ')}
                </Text>
              </View>
              <View style={[styles.badge, styles.protocolBadge]}>
                <Text style={styles.badgeText}>{protocolLabels[provider.protocol]}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.cardBody}>
            {/* Configuration Section */}
            {provider.protocol === 'saml2' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SAML Configuration</Text>
                {provider.samlConfig ? (
                  <View>
                    <Text style={styles.configLabel}>Entity ID</Text>
                    <Text style={styles.configValue}>{provider.samlConfig.entityId}</Text>
                    <Text style={styles.configLabel}>SSO URL</Text>
                    <Text style={styles.configValue}>{provider.samlConfig.ssoUrl}</Text>
                    <Text style={styles.configLabel}>Certificates</Text>
                    <Text style={styles.configValue}>
                      {provider.samlConfig.certificates.length} certificate(s) configured
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleUploadMetadata(provider)}>
                    <Text style={styles.actionButtonText}>Upload IdP Metadata (XML)</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {provider.protocol === 'oidc' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>OIDC Configuration</Text>
                {provider.oidcConfig ? (
                  <View>
                    <Text style={styles.configLabel}>Issuer</Text>
                    <Text style={styles.configValue}>{provider.oidcConfig.issuer}</Text>
                    <Text style={styles.configLabel}>Client ID</Text>
                    <Text style={styles.configValue}>{provider.oidcConfig.clientId}</Text>
                  </View>
                ) : (
                  <Text style={styles.configValue}>Not configured — set up via API</Text>
                )}
              </View>
            )}

            {/* JIT Provisioning */}
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <Text style={styles.sectionTitle}>Just-In-Time Provisioning</Text>
                <Switch
                  value={provider.jitProvisioningEnabled}
                  onValueChange={() => toggleJIT(provider.id)}
                  trackColor={{ false: '#ccc', true: colors.primary }}
                />
              </View>
              <Text style={styles.helperText}>
                Automatically create user accounts on first SSO login
              </Text>
            </View>

            {/* Role Mappings */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Role Mappings</Text>
              {provider.roleMappings.map((mapping, index) => (
                <View key={`${mapping.idpGroup}-${index}`} style={styles.mappingRow}>
                  <Text style={styles.mappingText}>
                    {mapping.idpGroup} → {roleLabels[mapping.subtrackrRole]}
                  </Text>
                  <TouchableOpacity onPress={() => handleRemoveRoleMapping(provider, index)}>
                    <Text style={styles.removeText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <View style={styles.addMappingRow}>
                <TextInput
                  style={styles.groupInput}
                  placeholder="IdP Group"
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  placeholderTextColor="#999"
                />
                <View style={styles.roleSelector}>
                  {AVAILABLE_ROLES.map((role) => (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleChip, newGroupRole === role && styles.roleChipActive]}
                      onPress={() => setNewGroupRole(role)}>
                      <Text
                        style={[
                          styles.roleChipText,
                          newGroupRole === role && styles.roleChipTextActive,
                        ]}>
                        {roleLabels[role]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => handleAddRoleMapping(provider)}>
                  <Text style={styles.addButtonText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* SCIM Users */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Provisioned Users ({providerUsers.length})</Text>
              {providerUsers.slice(0, 5).map((user) => (
                <View key={user.id} style={styles.userRow}>
                  <View>
                    <Text style={styles.userName}>{user.displayName}</Text>
                    <Text style={styles.userEmail}>{user.email}</Text>
                  </View>
                  <View style={styles.userActions}>
                    <View style={[styles.badge, styles.roleBadge]}>
                      <Text style={styles.badgeText}>{roleLabels[user.role]}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deactivateSCIMUser(user.id)}>
                      <Text style={styles.removeText}>Deactivate</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            {/* Provider Actions */}
            <View style={styles.providerActions}>
              {provider.status === 'active' ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={() => deactivateProvider(provider.id)}>
                  <Text style={styles.dangerButtonText}>Deactivate Provider</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => activateProvider(provider.id)}>
                  <Text style={styles.actionButtonText}>Activate Provider</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionButton, styles.dangerButton]}
                onPress={() => handleRemoveProvider(provider)}>
                <Text style={styles.dangerButtonText}>Remove Provider</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Enterprise SSO</Text>
        <Text style={styles.subtitle}>
          Configure SAML 2.0 and OpenID Connect identity providers for single sign-on
        </Text>

        {error && (
          <TouchableOpacity style={styles.errorBanner} onPress={clearError}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </TouchableOpacity>
        )}

        {/* Quick Setup Presets */}
        {providers.length === 0 && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Quick Setup</Text>
            <Text style={styles.helperText}>
              Choose a supported identity provider to get started
            </Text>
            <View style={styles.presetGrid}>
              {SSO_PROVIDER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={styles.presetButton}
                  onPress={() => {
                    addProvider('org_default', preset.name, preset.protocol);
                    Alert.alert('Provider Added', `${preset.name} has been added.`);
                  }}>
                  <Text style={styles.presetName}>{preset.name}</Text>
                  <Text style={styles.presetProtocol}>{protocolLabels[preset.protocol]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>
        )}

        {/* Provider List */}
        {providers.map(renderProviderCard)}

        {/* Add Provider */}
        {showAddProvider ? (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Add Identity Provider</Text>
            <TextInput
              style={styles.input}
              placeholder="Provider name (e.g., Corporate Okta)"
              value={newProviderName}
              onChangeText={setNewProviderName}
              placeholderTextColor="#999"
            />
            <View style={styles.protocolSelector}>
              {(['saml2', 'oidc'] as SSOProtocol[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.protocolOption,
                    newProviderProtocol === p && styles.protocolOptionActive,
                  ]}
                  onPress={() => setNewProviderProtocol(p)}>
                  <Text
                    style={[
                      styles.protocolOptionText,
                      newProviderProtocol === p && styles.protocolOptionTextActive,
                    ]}>
                    {protocolLabels[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.actionButton} onPress={handleAddProvider}>
                <Text style={styles.actionButtonText}>Create Provider</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => setShowAddProvider(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : (
          <TouchableOpacity
            style={styles.addProviderButton}
            onPress={() => setShowAddProvider(true)}>
            <Text style={styles.addProviderButtonText}>+ Add Identity Provider</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: '#666', marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardBody: { marginTop: spacing.md },
  providerInfo: { flex: 1 },
  providerName: { ...typography.h3, marginBottom: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.xs },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: '#f0f0f0',
  },
  protocolBadge: { backgroundColor: '#e0e7ff' },
  roleBadge: { backgroundColor: '#fef3c7' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  expandIcon: { fontSize: 12, color: '#999' },
  section: {
    marginBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  sectionTitle: { ...typography.h4, marginBottom: spacing.xs },
  helperText: { fontSize: 13, color: '#888', marginBottom: spacing.sm },
  configLabel: { fontSize: 12, color: '#666', marginTop: spacing.xs },
  configValue: { fontSize: 14, marginBottom: spacing.xs },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mappingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  mappingText: { fontSize: 14 },
  removeText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  addMappingRow: { marginTop: spacing.sm },
  groupInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    fontSize: 14,
  },
  roleSelector: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  roleChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: '#f0f0f0',
  },
  roleChipActive: { backgroundColor: colors.primary },
  roleChipText: { fontSize: 12, color: '#666' },
  roleChipTextActive: { color: '#fff' },
  addButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  addButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  userName: { fontSize: 14, fontWeight: '600' },
  userEmail: { fontSize: 12, color: '#888' },
  userActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  providerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    flex: 1,
  },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dangerButton: { backgroundColor: '#fee2e2' },
  dangerButtonText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  cancelButton: { backgroundColor: '#f5f5f5' },
  cancelButtonText: { color: '#666', fontWeight: '600', fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    fontSize: 14,
  },
  protocolSelector: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  protocolOption: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  protocolOptionActive: { backgroundColor: colors.primary },
  protocolOptionText: { fontWeight: '600', color: '#666' },
  protocolOptionTextActive: { color: '#fff' },
  formActions: { flexDirection: 'row', gap: spacing.sm },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  presetButton: {
    width: '47%',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e9ecef',
    alignItems: 'center',
  },
  presetName: { fontWeight: '700', fontSize: 14, marginBottom: 2 },
  presetProtocol: { fontSize: 11, color: '#888' },
  addProviderButton: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addProviderButtonText: { color: colors.primary, fontWeight: '600' },
  errorBanner: {
    backgroundColor: '#fee2e2',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorText: { color: '#ef4444', flex: 1, fontSize: 13 },
  errorDismiss: { color: '#ef4444', fontWeight: '700', fontSize: 13 },
});

export default SSOSettingsScreen;
