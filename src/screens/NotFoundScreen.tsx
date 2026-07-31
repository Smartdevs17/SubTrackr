import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../utils/constants';

type NotFoundNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function NotFoundScreen() {
  const navigation = useNavigation<NotFoundNavigationProp>();
  const route = useRoute();
  const reason = (route.params as { reason?: string } | undefined)?.reason;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Page not found</Text>
        <Text style={styles.subtitle}>
          The link could not be opened. Please check the URL and try again.
        </Text>
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        <TouchableOpacity
          onPress={() => navigation.navigate('Home')}
          accessibilityLabel="Go to home screen"
          style={styles.button}>
          <Text style={styles.buttonText}>Go to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  reason: {
    ...typography.body2,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
