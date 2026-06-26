import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const AffiliateDashboardScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Affiliate Dashboard</Text>
      <Text>Your Total Earnings: $0.00</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
});
