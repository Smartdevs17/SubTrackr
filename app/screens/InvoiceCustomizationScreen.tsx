import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, TextInput } from 'react-native';
import { spacing, typography, borderRadius } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useInvoiceStore } from '../../src/store/invoiceStore';

export const InvoiceCustomizationScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  
  const { config, templates, setInvoiceBranding, setDefaultTemplate } = useInvoiceStore();
  const branding = config.defaultBranding || { logoUrl: '', primaryColor: '#000000', fontFamily: 'Inter' };
  
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl || '');
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor || '#000000');
  const [fontFamily, setFontFamily] = useState(branding.fontFamily || 'Inter');
  const [selectedTemplate, setSelectedTemplate] = useState(config.defaultTemplateId || templates[0]?.id);

  const handleSave = () => {
    setInvoiceBranding({ logoUrl, primaryColor, fontFamily });
    if (selectedTemplate) setDefaultTemplate(selectedTemplate);
    alert('Invoice branding saved!');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Invoice Customization</Text>
          <Text style={styles.subtitle}>Customize your per-tenant branding</Text>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Branding</Text>
          <Text style={styles.label}>Logo URL</Text>
          <TextInput 
            style={styles.input} 
            value={logoUrl} 
            onChangeText={setLogoUrl} 
            placeholder="https://example.com/logo.png" 
          />
          
          <Text style={styles.label}>Primary Color</Text>
          <TextInput 
            style={styles.input} 
            value={primaryColor} 
            onChangeText={setPrimaryColor} 
            placeholder="#HEXCODE" 
          />
          
          <Text style={styles.label}>Font Family</Text>
          <TextInput 
            style={styles.input} 
            value={fontFamily} 
            onChangeText={setFontFamily} 
            placeholder="e.g. Inter, Roboto" 
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Template Selection</Text>
          {templates.map(tpl => (
            <TouchableOpacity 
              key={tpl.id} 
              style={[
                styles.templateItem, 
                selectedTemplate === tpl.id && { borderColor: colors.primary, backgroundColor: colors.surface }
              ]}
              onPress={() => setSelectedTemplate(tpl.id)}
            >
              <Text style={styles.templateName}>{tpl.name}</Text>
              <Text style={{color: colors.textSecondary}}>{tpl.layout} layout</Text>
            </TouchableOpacity>
          ))}
        </Card>
        
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Preview</Text>
          <View style={[styles.previewBox, { borderColor: primaryColor }]}>
             <Text style={{ fontFamily, color: primaryColor, fontSize: 24, fontWeight: 'bold' }}>INVOICE</Text>
             {logoUrl ? <Text style={{ fontFamily }}>Logo: {logoUrl}</Text> : null}
             <Text style={{ fontFamily, marginTop: 10 }}>This is a preview of your custom invoice styling.</Text>
          </View>
        </Card>

        <TouchableOpacity style={styles.actionButton} onPress={handleSave}>
          <Text style={styles.actionButtonText}>Save Customization</Text>
        </TouchableOpacity>
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
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    label: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    input: {
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
      marginBottom: spacing.md,
      color: colors.text.primary,
    },
    templateItem: {
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    templateName: { ...typography.body, fontWeight: 'bold', color: colors.text.primary },
    previewBox: {
      borderWidth: 2,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      minHeight: 150,
      backgroundColor: '#fff',
    },
    actionButton: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.xl,
      backgroundColor: colors.primary,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center'
    },
    actionButtonText: {
      ...typography.button,
      color: colors.text.inverse
    },
  });
}
