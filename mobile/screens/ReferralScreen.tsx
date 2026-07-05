import React from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';

export const ReferralScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Refer a Friend</Text>
      <Text>Share your link and earn commissions.</Text>
      <Button title="Generate Link" onPress={() => {}} />
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
