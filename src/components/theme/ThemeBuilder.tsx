import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useThemeStore } from '../../theme/themeStore';
import { useTheme } from '../../theme/useTheme';
import { ThemePreview } from './ThemePreview';

const COLOR_FIELDS: { key: 'primary' | 'secondary' | 'accent'; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
];

/** Full theme builder: pick built-in themes, toggle mode, or create a brand theme */
export const ThemeBuilder: React.FC = () => {
  const theme = useTheme();
  const { allThemes, toggleMode, addBrandTheme, removeCustomTheme, customThemes } = useThemeStore();
  const c = theme.colors;

  const [brandName, setBrandName] = useState('');
  const [brandColors, setBrandColors] = useState({
    primary: theme.colors.brand.primary,
    secondary: theme.colors.brand.secondary,
    accent: theme.colors.accent,
  });

  const handleCreate = () => {
    const name = brandName.trim();
    if (!name) return Alert.alert('Name required', 'Enter a name for your brand theme.');
    const id = `brand-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    addBrandTheme(brandColors, id, name);
    setBrandName('');
  };

  return (
    <ScrollView
      style={{ backgroundColor: c.background.primary }}
      contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: c.text.primary }]}>Theme</Text>

      {/* Mode toggle */}
      <TouchableOpacity
        style={[
          styles.toggleBtn,
          { backgroundColor: c.background.card, borderColor: c.border.default },
        ]}
        onPress={toggleMode}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} mode`}>
        <Text style={[styles.toggleText, { color: c.text.primary }]}>
          {theme.mode === 'dark' ? '☀️  Switch to Light' : '🌙  Switch to Dark'}
        </Text>
      </TouchableOpacity>

      {/* Theme picker */}
      <Text style={[styles.label, { color: c.text.secondary }]}>Choose Theme</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
        {allThemes().map((t) => (
          <ThemePreview key={t.id} theme={t} />
        ))}
      </ScrollView>

      {/* Brand theme builder */}
      <Text style={[styles.label, { color: c.text.secondary }]}>Create Brand Theme</Text>
      <View
        style={[
          styles.card,
          { backgroundColor: c.background.card, borderColor: c.border.default },
        ]}>
        <TextInput
          style={[
            styles.input,
            {
              color: c.text.primary,
              borderColor: c.border.default,
              backgroundColor: c.background.secondary,
            },
          ]}
          placeholder="Brand name"
          placeholderTextColor={c.text.secondary}
          value={brandName}
          onChangeText={setBrandName}
          accessibilityLabel="Brand theme name"
        />
        {COLOR_FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.colorRow}>
            <View style={[styles.colorDot, { backgroundColor: brandColors[key] }]} />
            <Text style={[styles.colorLabel, { color: c.text.primary }]}>{label}</Text>
            <TextInput
              style={[
                styles.colorInput,
                {
                  color: c.text.primary,
                  borderColor: c.border.default,
                  backgroundColor: c.background.secondary,
                },
              ]}
              value={brandColors[key]}
              onChangeText={(v) => setBrandColors((prev) => ({ ...prev, [key]: v }))}
              autoCapitalize="none"
              accessibilityLabel={`${label} color hex`}
            />
          </View>
        ))}
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: c.brand.primary }]}
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel="Create brand theme">
          <Text style={[styles.createBtnText, { color: c.onPrimary }]}>Create Theme</Text>
        </TouchableOpacity>
      </View>

      {/* Remove custom themes */}
      {customThemes.length > 0 && (
        <>
          <Text style={[styles.label, { color: c.text.secondary }]}>Custom Themes</Text>
          {customThemes.map((t) => (
            <View
              key={t.id}
              style={[
                styles.customRow,
                { backgroundColor: c.background.card, borderColor: c.border.default },
              ]}>
              <Text style={[styles.customName, { color: c.text.primary }]}>{t.name}</Text>
              <TouchableOpacity
                onPress={() => removeCustomTheme(t.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${t.name} theme`}>
                <Text style={{ color: c.status.error, fontWeight: '600' }}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 24 },
  heading: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toggleBtn: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    marginBottom: 4,
  },
  toggleText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15, marginBottom: 12 },
  colorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  colorDot: { width: 20, height: 20, borderRadius: 10, marginRight: 10 },
  colorLabel: { width: 80, fontSize: 14 },
  colorInput: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 13 },
  createBtn: { borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  createBtnText: { fontWeight: '700', fontSize: 15 },
  customRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  customName: { fontSize: 15, fontWeight: '500' },
});
