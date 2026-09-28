/**
 * PlaygroundPage.tsx
 *
 * Issue #1176 — Add API playground with interactive docs
 *
 * A dedicated full-page wrapper for the ApiPlayground component inside the
 * developer portal. Shown via the "API Playground" navigation entry.
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiPlayground } from '../components/ApiPlayground';

export const PlaygroundPage: React.FC = () => (
  <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <Text style={styles.title}>API Playground</Text>
      <Text style={styles.subtitle}>
        Interactively explore every SubTrackr API endpoint right here — requests run against
        the sandbox environment so no production data is touched.
      </Text>
    </View>

    <View style={styles.notice}>
      <Text style={styles.noticeText}>
        🔒 All requests use your sandbox API key. Switch to a production key only when you
        are ready to go live.
      </Text>
    </View>

    <ApiPlayground />
  </ScrollView>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
  },
  notice: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    fontSize: 13,
    color: '#1D4ED8',
    lineHeight: 18,
  },
});

export default PlaygroundPage;
