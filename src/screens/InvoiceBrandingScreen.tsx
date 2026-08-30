import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useInvoiceStore } from '../store/invoiceStore';
import { useTheme } from '../theme/useTheme';
import type { InvoiceBranding } from '../types/invoice';

export default function InvoiceBrandingScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { branding, isLoading, loadBranding, saveBranding } = useInvoiceStore();

  const [formData, setFormData] = useState({
    companyName: '',
    companyLogo: '',
    primaryColor: '#4F46E5',
    secondaryColor: '#6B7280',
    accentColor: '#10B981',
    fontFamily: 'Arial, sans-serif',
    logoPosition: 'left' as 'left' | 'center' | 'right',
  });

  useEffect(() => {
    loadBranding();
  }, []);

  useEffect(() => {
    if (branding) {
      setFormData({
        companyName: branding.companyName,
        companyLogo: branding.companyLogo || '',
        primaryColor: branding.primaryColor,
        secondaryColor: branding.secondaryColor,
        accentColor: branding.accentColor || '#10B981',
        fontFamily: branding.fontFamily || 'Arial, sans-serif',
        logoPosition: branding.logoPosition || 'left',
      });
    }
  }, [branding]);

  const handleSave = async () => {
    if (!formData.companyName.trim()) {
      Alert.alert('Error', 'Company name is required');
      return;
    }

    try {
      await saveBranding(formData);
      Alert.alert('Success', 'Branding saved successfully');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to save branding');
    }
  };

  const colorPresets = [
    { name: 'Indigo', primary: '#4F46E5', secondary: '#6B7280' },
    { name: 'Blue', primary: '#3B82F6', secondary: '#6B7280' },
    { name: 'Green', primary: '#10B981', secondary: '#6B7280' },
    { name: 'Purple', primary: '#8B5CF6', secondary: '#6B7280' },
    { name: 'Red', primary: '#EF4444', secondary: '#6B7280' },
    { name: 'Orange', primary: '#F97316', secondary: '#6B7280' },
  ];

  if (isLoading && !branding) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Company Information</Text>

        <Text style={[styles.label, { color: theme.colors.text }]}>Company Name *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.card, color: theme.colors.text }]}
          value={formData.companyName}
          onChangeText={text => setFormData({ ...formData, companyName: text })}
          placeholder="Enter company name"
          placeholderTextColor={theme.colors.textSecondary}
        />

        <Text style={[styles.label, { color: theme.colors.text }]}>Company Logo URL</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.card, color: theme.colors.text }]}
          value={formData.companyLogo}
          onChangeText={text => setFormData({ ...formData, companyLogo: text })}
          placeholder="https://example.com/logo.png"
          placeholderTextColor={theme.colors.textSecondary}
        />

        <Text style={[styles.label, { color: theme.colors.text }]}>Logo Position</Text>
        <View style={styles.radioGroup}>
          {['left', 'center', 'right'].map(position => (
            <TouchableOpacity
              key={position}
              style={[
                styles.radioButton,
                { backgroundColor: theme.colors.card },
                formData.logoPosition === position && {
                  backgroundColor: theme.colors.primary,
                },
              ]}
              onPress={() =>
                setFormData({ ...formData, logoPosition: position as 'left' | 'center' | 'right' })
              }
            >
              <Text
                style={[
                  styles.radioButtonText,
                  { color: theme.colors.text },
                  formData.logoPosition === position && { color: '#FFFFFF' },
                ]}
              >
                {position.charAt(0).toUpperCase() + position.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Color Scheme</Text>

        <Text style={[styles.label, { color: theme.colors.text }]}>Color Presets</Text>
        <View style={styles.presetGrid}>
          {colorPresets.map(preset => (
            <TouchableOpacity
              key={preset.name}
              style={[styles.presetCard, { backgroundColor: theme.colors.card }]}
              onPress={() =>
                setFormData({
                  ...formData,
                  primaryColor: preset.primary,
                  secondaryColor: preset.secondary,
                })
              }
            >
              <View style={styles.presetColors}>
                <View
                  style={[styles.colorCircle, { backgroundColor: preset.primary }]}
                />
                <View
                  style={[styles.colorCircle, { backgroundColor: preset.secondary }]}
                />
              </View>
              <Text style={[styles.presetName, { color: theme.colors.text }]}>{preset.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: theme.colors.text }]}>Primary Color</Text>
        <View style={styles.colorInputContainer}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: theme.colors.card, color: theme.colors.text }]}
            value={formData.primaryColor}
            onChangeText={text => setFormData({ ...formData, primaryColor: text })}
            placeholder="#4F46E5"
            placeholderTextColor={theme.colors.textSecondary}
          />
          <View
            style={[styles.colorPreview, { backgroundColor: formData.primaryColor }]}
          />
        </View>

        <Text style={[styles.label, { color: theme.colors.text }]}>Secondary Color</Text>
        <View style={styles.colorInputContainer}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: theme.colors.card, color: theme.colors.text }]}
            value={formData.secondaryColor}
            onChangeText={text => setFormData({ ...formData, secondaryColor: text })}
            placeholder="#6B7280"
            placeholderTextColor={theme.colors.textSecondary}
          />
          <View
            style={[styles.colorPreview, { backgroundColor: formData.secondaryColor }]}
          />
        </View>

        <Text style={[styles.label, { color: theme.colors.text }]}>Accent Color</Text>
        <View style={styles.colorInputContainer}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: theme.colors.card, color: theme.colors.text }]}
            value={formData.accentColor}
            onChangeText={text => setFormData({ ...formData, accentColor: text })}
            placeholder="#10B981"
            placeholderTextColor={theme.colors.textSecondary}
          />
          <View
            style={[styles.colorPreview, { backgroundColor: formData.accentColor }]}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Typography</Text>

        <Text style={[styles.label, { color: theme.colors.text }]}>Font Family</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.card, color: theme.colors.text }]}
          value={formData.fontFamily}
          onChangeText={text => setFormData({ ...formData, fontFamily: text })}
          placeholder="Arial, sans-serif"
          placeholderTextColor={theme.colors.textSecondary}
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton, { backgroundColor: theme.colors.card }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={[styles.buttonText, { color: theme.colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.colors.primary }]}
          onPress={handleSave}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Save Branding</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    padding: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  radioGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  radioButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  radioButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  presetCard: {
    width: '30%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetColors: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  colorCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  presetName: {
    fontSize: 12,
    fontWeight: '500',
  },
  colorInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorPreview: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
