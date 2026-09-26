/**
 * ApiPlaygroundScreen.tsx
 *
 * Issue #1176 — Add API playground with interactive docs
 *
 * Native-app screen that wraps the developer portal's ApiPlayground component
 * so it is accessible from the app's navigation stack.
 */

import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiPlayground } from '../../developer-portal/components/ApiPlayground';
import { colors, spacing, typography } from '../utils/constants';

const ApiPlaygroundScreen: React.FC = () => (
  <SafeAreaView style={styles.root} accessibilityLabel="API Playground screen" testID="api-playground-screen">
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">
        API Playground
      </Text>
      <Text style={styles.subtitle}>
        Try SubTrackr API endpoints interactively against the sandbox — no production impact.
      </Text>
    </View>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <ApiPlayground />
    </ScrollView>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
});

export default ApiPlaygroundScreen;
