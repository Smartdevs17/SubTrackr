import React, { useMemo, useState } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../context/ThemeContext';

type SettingsNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const SettingsScreen = () => {
  const navigation = useNavigation<SettingsNavigationProp>();
  const { colors, mode, setMode } = useTheme();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} testID="settings-screen">
      <Text style={styles.header}>Notification Preferences</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        {(['system', 'light', 'dark'] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={styles.modeRow}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === option }}
            accessibilityLabel={`${option} mode`}
            onPress={() => setMode(option)}>
            <View style={styles.modeTextWrap}>
              <Text style={styles.modeLabel}>
                {option === 'system' ? 'Follow System' : option === 'light' ? 'Light' : 'Dark'}
              </Text>
              <Text style={styles.modeSubLabel}>
                {option === 'system'
                  ? 'Use the device appearance setting'
                  : option === 'light'
                    ? 'Always use light colors'
                    : 'Always use dark colors'}
              </Text>
            </View>
            <View style={[styles.radio, mode === option && styles.radioActive]}>
              {mode === option && <View style={styles.radioDot} />}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Delivery Channels</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Push Notifications</Text>
          <Switch
            value={pushEnabled}
            onValueChange={setPushEnabled}
            trackColor={{ false: colors.border.default, true: colors.brand.primary }}
            thumbColor={colors.background.card}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Email Notifications</Text>
          <Switch
            value={emailEnabled}
            onValueChange={setEmailEnabled}
            trackColor={{ false: colors.border.default, true: colors.brand.primary }}
            thumbColor={colors.background.card}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>SMS Notifications</Text>
          <Switch
            value={smsEnabled}
            onValueChange={setSmsEnabled}
            trackColor={{ false: colors.border.default, true: colors.brand.primary }}
            thumbColor={colors.background.card}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quiet Hours</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Enable Quiet Hours (No alerts 10 PM - 7 AM)</Text>
          <Switch
            value={quietHoursEnabled}
            onValueChange={setQuietHoursEnabled}
            trackColor={{ false: colors.border.default, true: colors.brand.primary }}
            thumbColor={colors.background.card}
          />
        </View>
      </View>

      {__DEV__ && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <TouchableOpacity
            style={styles.debugButton}
            testID="performance-dashboard-link"
            onPress={() => navigation.navigate('PerformanceDashboard')}>
            <Text style={styles.debugButtonText}>Performance Dashboard</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 16,
      backgroundColor: colors.background.primary,
    },
    header: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 20,
      color: colors.text.primary,
    },
    section: { marginBottom: 24 },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
      color: colors.text.primary,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    rowLabel: {
      flex: 1,
      paddingRight: 12,
      color: colors.text.primary,
    },
    modeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 12,
      marginBottom: 10,
      borderRadius: 12,
      backgroundColor: colors.background.secondary,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    modeTextWrap: {
      flex: 1,
      paddingRight: 12,
    },
    modeLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text.primary,
    },
    modeSubLabel: {
      marginTop: 4,
      fontSize: 13,
      color: colors.text.secondary,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioActive: {
      borderColor: colors.brand.primary,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.brand.primary,
    },
    debugButton: {
      backgroundColor: colors.brand.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    debugButtonText: { color: colors.onPrimary, fontWeight: '700' },
  });
}
