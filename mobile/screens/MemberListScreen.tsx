import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const MemberListScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Members</Text>
      <Text>View all members in your group.</Text>
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
