import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const GroupManagementScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Group Management</Text>
      <Text>Manage your family or team subscription here.</Text>
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
