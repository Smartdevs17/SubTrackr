import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView } from 'react-native';

export const SettingsScreen = () => {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Notification Preferences</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Delivery Channels</Text>
        <View style={styles.row}>
          <Text>Push Notifications</Text>
          <Switch value={pushEnabled} onValueChange={setPushEnabled} />
        </View>
        <View style={styles.row}>
          <Text>Email Notifications</Text>
          <Switch value={emailEnabled} onValueChange={setEmailEnabled} />
        </View>
        <View style={styles.row}>
          <Text>SMS Notifications</Text>
          <Switch value={smsEnabled} onValueChange={setSmsEnabled} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quiet Hours</Text>
        <View style={styles.row}>
          <Text>Enable Quiet Hours (No alerts 10 PM - 7 AM)</Text>
          <Switch value={quietHoursEnabled} onValueChange={setQuietHoursEnabled} />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
});
