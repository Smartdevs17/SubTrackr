import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import { spacing, typography, borderRadius } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useInvoiceStore } from '../../src/store/invoiceStore';

const MARKETPLACE_TEMPLATES = [
  { id: 'tpl-1', name: 'Standard Layout', layout: 'standard', price: 'Free' },
  { id: 'tpl-2', name: 'Modern Minimalist', layout: 'modern', price: 'Free' },
  { id: 'tpl-3', name: 'Premium Corporate', layout: 'premium', price: '$4.99' },
  { id: 'tpl-4', name: 'Creative Studio', layout: 'creative', price: '$2.99' },
];

export const InvoiceMarketplaceScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { templates, addTemplate } = useInvoiceStore();

  const handleInstall = (template: any) => {
    const isInstalled = templates.some(t => t.id === template.id);
    if (isInstalled) {
      alert('Template already installed!');
      return;
    }
    
    // Simulate purchase/installation
    addTemplate({ id: template.id, name: template.name, layout: template.layout as any });
    alert(`${template.name} has been added to your templates!`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Template Marketplace</Text>
          <Text style={styles.subtitle}>Discover and install new invoice layouts</Text>
        </View>

        {MARKETPLACE_TEMPLATES.map(tpl => {
          const isInstalled = templates.some(t => t.id === tpl.id);
          
          return (
            <Card key={tpl.id} style={styles.card}>
              <View style={styles.row}>
                <View style={styles.info}>
                  <Text style={styles.templateName}>{tpl.name}</Text>
                  <Text style={styles.templateDesc}>Style: {tpl.layout}</Text>
                </View>
                <View style={styles.action}>
                  <Text style={styles.price}>{tpl.price}</Text>
                  <TouchableOpacity 
                    style={[styles.button, isInstalled && styles.buttonInstalled]} 
                    onPress={() => handleInstall(tpl)}
                    disabled={isInstalled}
                  >
                    <Text style={styles.buttonText}>{isInstalled ? 'Installed' : 'Get'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: any) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    header: { padding: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    info: { flex: 1 },
    templateName: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.xs },
    templateDesc: { ...typography.caption, color: colors.textSecondary },
    action: { alignItems: 'flex-end' },
    price: { ...typography.body, fontWeight: 'bold', color: colors.text.primary, marginBottom: spacing.xs },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
    },
    buttonInstalled: {
      backgroundColor: colors.border.default,
    },
    buttonText: {
      ...typography.button,
      color: colors.text.inverse,
      fontSize: 12
    }
  });
}
