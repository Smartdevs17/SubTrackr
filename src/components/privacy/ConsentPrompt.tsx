/**
 * ConsentPrompt.tsx
 *
 * Blocking modal shown on first launch and whenever the privacy policy
 * version changes. "Accept all" and "Reject non-essential" are offered with
 * equal prominence on the first layer, as GDPR requires refusing consent to
 * be as easy as giving it; "Customize" reveals per-category toggles.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useConsentManager } from '../../hooks/useConsentManager';
import {
  CONSENT_CATEGORIES,
  ESSENTIAL_PROCESSING,
  ConsentService,
  consentService as defaultConsentService,
} from '../../services/consentService';
import { ConsentCategoryRow } from './ConsentCategoryRow';

interface ConsentPromptProps {
  service?: ConsentService;
}

export const ConsentPrompt = ({ service = defaultConsentService }: ConsentPromptProps) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const consent = useConsentManager(service);
  const [customizing, setCustomizing] = useState(false);

  const visible = consent.status === 'ready' && consent.requiresConsent;
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View
          style={styles.sheet}
          testID="consent-prompt"
          accessibilityViewIsModal
          accessibilityLabel="Privacy consent">
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title} accessibilityRole="header">
              {consent.isPolicyUpdate ? 'Our privacy policy has changed' : 'Your privacy choices'}
            </Text>
            <Text style={styles.body}>
              {consent.isPolicyUpdate ? 'Please review your choices for the updated policy. ' : ''}
              SubTrackr only uses optional data with your permission. You can change these choices
              at any time in Settings › Privacy.
            </Text>

            {customizing && (
              <View testID="consent-prompt-categories">
                <ConsentCategoryRow
                  testID="consent-prompt-essential"
                  title={ESSENTIAL_PROCESSING.title}
                  description={ESSENTIAL_PROCESSING.description}
                  legalBasis={ESSENTIAL_PROCESSING.legalBasis}
                  value
                  locked
                />
                {CONSENT_CATEGORIES.map((category) => (
                  <ConsentCategoryRow
                    key={category.key}
                    testID={`consent-prompt-${category.key}`}
                    title={category.title}
                    description={category.description}
                    legalBasis={category.legalBasis}
                    value={consent.draft[category.key]}
                    onValueChange={(value) => consent.setCategory(category.key, value)}
                    disabled={consent.saving}
                  />
                ))}
              </View>
            )}

            {consent.error && (
              <Text style={styles.error} testID="consent-prompt-error" accessibilityRole="alert">
                {consent.error}
              </Text>
            )}
          </ScrollView>

          {consent.saving ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                testID="consent-accept-all"
                onPress={() => void consent.acceptAll('banner')}
                accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Accept all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                testID="consent-reject-all"
                onPress={() => void consent.rejectAll('banner')}
                accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Reject non-essential</Text>
              </TouchableOpacity>
              {customizing ? (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  testID="consent-save-choices"
                  onPress={() => void consent.saveDraft('banner')}
                  accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>Save my choices</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  testID="consent-customize"
                  onPress={() => setCustomizing(true)}
                  accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>Customize</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
    sheet: {
      maxHeight: '85%',
      backgroundColor: colors.background.modal,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 24,
    },
    content: { padding: 20 },
    title: { fontSize: 20, fontWeight: '700', color: colors.text.primary, marginBottom: 8 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: 12 },
    error: { fontSize: 13, color: colors.error, marginTop: 12 },
    spinner: { marginVertical: 24 },
    actions: { paddingHorizontal: 20, gap: 10 },
    button: { paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
    primaryButton: { backgroundColor: colors.primary },
    primaryButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
    secondaryButton: { borderWidth: 1, borderColor: colors.border.default },
    secondaryButtonText: { color: colors.text.primary, fontSize: 16, fontWeight: '600' },
  });
}

export default ConsentPrompt;
