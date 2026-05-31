import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';

interface RateLimitConfigProps {
  rateLimit: number;
  dailyLimit: number;
  onRateLimitChange: (value: number) => void;
  onDailyLimitChange: (value: number) => void;
}

export const RateLimitConfig: React.FC<RateLimitConfigProps> = ({
  rateLimit,
  dailyLimit,
  onRateLimitChange,
  onDailyLimitChange,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.limitCard}>
        <Text style={styles.limitLabel}>Requests per Minute</Text>
        <TextInput
          style={styles.limitInput}
          value={rateLimit.toString()}
          onChangeText={(text) => onRateLimitChange(parseInt(text) || 0)}
          keyboardType="number-pad"
          placeholder="100"
        />
        <Text style={styles.limitHint}>Maximum requests allowed per minute</Text>
      </View>

      <View style={styles.limitCard}>
        <Text style={styles.limitLabel}>Requests per Day</Text>
        <TextInput
          style={styles.limitInput}
          value={dailyLimit.toString()}
          onChangeText={(text) => onDailyLimitChange(parseInt(text) || 0)}
          keyboardType="number-pad"
          placeholder="10000"
        />
        <Text style={styles.limitHint}>Maximum requests allowed per day</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>
          Rate limits help protect your API from abuse and ensure fair usage across all clients.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  limitCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  limitLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  limitInput: {
    backgroundColor: '#F5F5F7',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    color: '#000',
    marginBottom: 8,
  },
  limitHint: {
    fontSize: 12,
    color: '#666',
  },
  infoCard: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#1976D2',
    lineHeight: 18,
  },
});
