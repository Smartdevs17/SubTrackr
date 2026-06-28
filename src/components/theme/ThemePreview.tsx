import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Theme } from '../../theme/types';
import { useThemeStore } from '../../theme/themeStore';

interface Props {
  theme: Theme;
}

/** Shows a colour swatch preview of a theme with an "Apply" button */
export const ThemePreview: React.FC<Props> = ({ theme }) => {
  const { activeThemeId, setTheme } = useThemeStore();
  const isActive = activeThemeId === theme.id;
  const c = theme.colors;

  return (
    <TouchableOpacity
      onPress={() => setTheme(theme.id)}
      style={[
        styles.card,
        { backgroundColor: c.surface, borderColor: isActive ? c.primary : c.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Apply ${theme.name} theme`}
      accessibilityState={{ selected: isActive }}>
      {/* Mini colour swatches */}
      <View style={styles.swatches}>
        {[c.primary, c.secondary, c.accent, c.background].map((color, i) => (
          <View key={i} style={[styles.swatch, { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.name, { color: c.text }]}>{theme.name}</Text>
      <Text style={[styles.mode, { color: c.textSecondary }]}>{theme.mode}</Text>
      {isActive && (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={[styles.badgeText, { color: c.text }]}>Active</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: 120,
    borderRadius: 12,
    borderWidth: 2,
    padding: 12,
    marginRight: 12,
  },
  swatches: { flexDirection: 'row', marginBottom: 8 },
  swatch: { width: 18, height: 18, borderRadius: 9, marginRight: 4 },
  name: { fontSize: 14, fontWeight: '600' },
  mode: { fontSize: 12, marginTop: 2 },
  badge: {
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
});
