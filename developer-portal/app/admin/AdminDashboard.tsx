/**
 * developer-portal/app/admin/AdminDashboard.tsx
 *
 * Admin dashboard with step-up authentication protected actions.
 * Demonstrates WebAuthn-based step-up for sensitive admin operations.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import {
  createStepUpChallenge,
  verifyStepUpAuthentication,
  getAdminRouteConfig,
  requiresStepUp,
  type AdminAction,
  type StepUpChallenge,
} from '../../lib/webauthn';
import { portalService } from '../../services/portalService';

interface AdminDashboardProps {
  onNavigate?: (page: string) => void;
}

// Admin actions that require step-up
const STEP_UP_ACTIONS: { action: AdminAction; label: string; description: string }[] = [
  {
    action: 'delete_user',
    label: 'Delete User',
    description: 'Permanently delete a user account and all associated data',
  },
  {
    action: 'suspend_user',
    label: 'Suspend/Reactivate User',
    description: 'Suspend or reactivate a user account',
  },
  {
    action: 'rotate_api_keys',
    label: 'Rotate API Keys',
    description: 'Rotate or revoke API keys for a user or environment',
  },
  {
    action: 'export_user_data',
    label: 'Export User Data',
    description: 'Export user data for GDPR/portability requests',
  },
  {
    action: 'modify_billing',
    label: 'Modify Billing',
    description: 'Modify billing configuration, plans, or payment methods',
  },
  {
    action: 'manage_webhooks',
    label: 'Manage Webhooks',
    description: 'Create, update, or delete webhook endpoints',
  },
  {
    action: 'configure_sso',
    label: 'Configure SSO',
    description: 'Configure SSO/SAML/OIDC providers',
  },
  {
    action: 'delete_environment',
    label: 'Delete Environment',
    description: 'Delete a sandbox environment and all its resources',
  },
  {
    action: 'reset_credentials',
    label: 'Reset Credentials',
    description: 'Reset user passwords, MFA, or recovery codes',
  },
  {
    action: 'view_audit_logs',
    label: 'View Audit Logs',
    description: 'View security audit logs and access trails',
  },
];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const [stepUpModal, setStepUpModal] = useState<{
    visible: boolean;
    challenge?: StepUpChallenge;
    action?: AdminAction;
  }>({ visible: false });
  const [webauthnCredential, setWebauthnCredential] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleAction = useCallback((action: AdminAction) => {
    const routeConfig = getAdminRouteConfig(`/admin/${action.replace('_', '/')}`);
    const needsStepUp = routeConfig?.requireStepUp ?? requiresStepUp(action);

    if (needsStepUp) {
      const challenge = createStepUpChallenge(action, 'current_admin_user');
      setStepUpModal({
        visible: true,
        challenge,
        action,
      });
    } else {
      executeAction(action);
    }
  }, []);

  const executeAction = useCallback(async (action: AdminAction) => {
    try {
      // In a real app, this would call the backend API
      await new Promise((resolve) => setTimeout(resolve, 500));
      setLastResult(`Action "${action}" executed successfully`);
    } catch (error) {
      setLastResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  const handleStepUpComplete = useCallback(async (credential: any) => {
    if (!stepUpModal.challenge || !stepUpModal.action) return;

    setVerifying(true);
    setWebauthnCredential(credential);

    try {
      // In a real app, this would call the backend to verify the credential
      // For demo, we simulate the verification
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = verifyStepUpAuthentication(
        stepUpModal.challenge.challenge, // Using challenge as ID for demo
        credential,
        window.location.origin,
        window.location.hostname,
        (_userId: string, _credentialId: string) => {
          // Mock stored credential lookup
          return {
            id: credential.id,
            userId: 'current_admin_user',
            publicKey: 'mock_public_key',
            signCount: 0,
            aaguid: 'mock_aaguid',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
          };
        }
      );

      if (result.verified) {
        setLastResult(`Step-up verified for "${stepUpModal.action}". Action executed.`);
        executeAction(stepUpModal.action);
      } else {
        setLastResult(`Step-up failed: ${result.error}`);
        Alert.alert('Verification Failed', result.error || 'Unknown error');
      }
    } catch (error) {
      setLastResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      Alert.alert('Error', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setVerifying(false);
      setStepUpModal({ visible: false });
      setWebauthnCredential(null);
    }
  }, [stepUpModal, executeAction]);

  const handleCancelStepUp = useCallback(() => {
    setStepUpModal({ visible: false });
  }, []);

  // Simulate WebAuthn credential creation/assertion
  // In a real app, this would use @simplewebauthn/browser
  const simulateWebAuthn = useCallback(async (action: 'create' | 'get') => {
    // This is a placeholder - in reality you'd use:
    // import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
    // const credential = await startRegistration(options) / startAuthentication(options);
    return {
      id: 'mock_credential_id_' + Date.now(),
      rawId: new ArrayBuffer(32),
      type: 'public-key',
      response: action === 'create'
        ? {
            clientDataJSON: 'mock_client_data',
            attestationObject: 'mock_attestation',
          }
        : {
            clientDataJSON: 'mock_client_data',
            authenticatorData: 'mock_auth_data',
            signature: 'mock_signature',
            userHandle: null,
          },
    };
  }, []);

  const handleWebAuthnPrompt = useCallback(async () => {
    if (!stepUpModal.challenge) return;

    setVerifying(true);
    try {
      // Simulate WebAuthn authentication
      const credential = await simulateWebAuthn('get');
      await handleStepUpComplete(credential);
    } catch (error) {
      Alert.alert('WebAuthn Error', error instanceof Error ? error.message : 'Failed to authenticate');
      setVerifying(false);
    }
  }, [stepUpModal, handleStepUpComplete]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Admin Dashboard</Text>
          <Text style={styles.subtitle}>
            Sensitive actions require WebAuthn step-up authentication
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Protected Actions</Text>
          <Text style={styles.sectionDescription}>
            Actions marked with \u{1F512} require WebAuthn step-up verification.
          </Text>

          {STEP_UP_ACTIONS.map(({ action, label, description }) => {
            const needsStepUp = requiresStepUp(action);
            return (
              <TouchableOpacity
                key={action}
                style={[
                  styles.actionCard,
                  needsStepUp ? styles.actionCardProtected : styles.actionCardNormal,
                ]}
                onPress={() => handleAction(action)}
              >
                <View style={styles.actionHeader}>
                  <Text style={styles.actionLabel}>{label}</Text>
                  {needsStepUp && <Text style={styles.lockIcon}>\u{1F512}</Text>}
                </View>
                <Text style={styles.actionDescription}>{description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {lastResult && (
          <View style={styles.resultSection}>
            <Text style={styles.sectionTitle}>Last Result</Text>
            <Text style={styles.resultText}>{lastResult}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WebAuthn Registration (Demo)</Text>
          <Text style={styles.sectionDescription}>
            Register a new authenticator for the current admin user.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={async () => {
            const credential = await simulateWebAuthn('create');
            Alert.alert('Registered', `Credential ID: ${credential.id}`);
          }}>
            <Text style={styles.primaryButtonText}>Register New Authenticator</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Step-up Modal */}
      <Modal
        visible={stepUpModal.visible}
        animationType="slide"
        transparent={false}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Step-Up Authentication Required</Text>
            <TouchableOpacity onPress={handleCancelStepUp}>
              <Text style={styles.modalClose}>\u{2715}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            {stepUpModal.challenge && (
              <>
                <Text style={styles.modalAction}>
                  Action: <Text style={styles.modalActionValue}>{stepUpModal.action}</Text>
                </Text>
                <Text style={styles.modalDescription}>
                  This action requires hardware-backed authentication.
                  Use your security key, Touch ID, Face ID, or Windows Hello.
                </Text>
                <View style={styles.challengeInfo}>
                  <Text style={styles.challengeLabel}>Challenge ID:</Text>
                  <Text style={styles.challengeValue}>
                    {stepUpModal.challenge.challenge.slice(0, 20)}...
                  </Text>
                  <Text style={styles.challengeLabel}>Expires:</Text>
                  <Text style={styles.challengeValue}>
                    {new Date(stepUpModal.challenge.expiresAt).toLocaleString()}
                  </Text>
                </View>
              </>
            )}

            {verifying ? (
              <View style={styles.verifyingContainer}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={styles.verifyingText}>Verifying WebAuthn credential...</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleWebAuthnPrompt}
                disabled={verifying}
              >
                <Text style={styles.primaryButtonText}>
                  Authenticate with WebAuthn
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.secondaryButton} onPress={handleCancelStepUp}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  actionCard: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  actionCardNormal: {
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  actionCardProtected: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  actionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  lockIcon: {
    fontSize: 18,
  },
  actionDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  resultSection: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  resultText: {
    fontSize: 14,
    color: '#065F46',
    fontFamily: 'monospace',
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  modalClose: {
    fontSize: 24,
    color: '#6B7280',
  },
  modalContent: {
    flex: 1,
    padding: 24,
  },
  modalAction: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 8,
  },
  modalActionValue: {
    fontWeight: '600',
    color: '#EF4444',
  },
  modalDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 20,
  },
  challengeInfo: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  challengeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  challengeValue: {
    fontSize: 14,
    color: '#111827',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  verifyingContainer: {
    alignItems: 'center',
    padding: 32,
  },
  verifyingText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 16,
  },
});