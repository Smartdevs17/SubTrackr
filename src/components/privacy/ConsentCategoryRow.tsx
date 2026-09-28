import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { LegalBasis } from '../../services/consentService';

interface ConsentCategoryRowProps {
  testID: string;
  title: string;
  description: string;
  legalBasis: LegalBasis;
  value: boolean;
  onValueChange?: (value: boolean) => void;
  /** Essential processing: always on and cannot be toggled. */
  locked?: boolean;
  disabled?: boolean;
}

const LEGAL_BASIS_LABEL: Record<LegalBasis, string> = {
  consent: 'Legal basis: your consent',
  contract: 'Legal basis: performance of contract',
};

export const ConsentCategoryRow = ({
  testID,
  title,
  description,
  legalBasis,
  value,
  onValueChange,
  locked = false,
  disabled = false,
}: ConsentCategoryRowProps) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <Text style={styles.meta}>
          {locked ? 'Always on · ' : ''}
          {LEGAL_BASIS_LABEL[legalBasis]}
        </Text>
      </View>
      <Switch
        testID={`${testID}-switch`}
        value={locked || value}
        onValueChange={onValueChange}
        disabled={locked || disabled}
        accessibilityRole="switch"
        accessibilityLabel={`${title} consent`}
        accessibilityHint={locked ? 'Required for the app to work' : undefined}
        accessibilityState={{ checked: locked || value, disabled: locked || disabled }}
      />
    </View>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    labelContainer: { flex: 1, paddingRight: 12 },
    label: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    description: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    meta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  });
}

export default ConsentCategoryRow;
