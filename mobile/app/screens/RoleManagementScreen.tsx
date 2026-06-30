// mobile/app/screens/RoleManagementScreen.tsx
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert 
} from 'react-native';

interface User {
  id: string;
  email: string;
  roleName: string;
}

interface Role {
  id: string;
  name: string;
}

export default function RoleManagementScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  // Load configuration options and active assignments
  useEffect(() => {
    async function fetchData() {
      try {
        // Replace URLs with your actual environment Gateway API points
        const [usersRes, rolesRes] = await Promise.all([
          fetch('/api/users'), 
          fetch('/api/auth/rbac/roles')
        ]);
        const usersData = await usersRes.json();
        const rolesData = await rolesRes.json();
        
        setUsers(usersData);
        setRoles(rolesData);
      } catch (error) {
        Alert.alert('Error', 'Failed to synchronize system access mappings.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleRoleUpdate = async (userId: string, roleId: string) => {
    setUpdatingUserId(userId);
    try {
      const response = await fetch('/api/auth/rbac/users/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Catches privilege escalation loops or invalid permission breaches
        throw new Error(result.message || 'Assignment rejected.');
      }

      Alert.alert('Success', 'Security role mutated successfully without elevation.');
      
      // Update UI state with local mapping arrays
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, roleName: roles.find(r => r.id === roleId)?.name || u.roleName } : u));
    } catch (error: any) {
      Alert.alert('Access Control Exception', error.message);
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0066cc" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>RBAC Authorization Engine</Text>
      
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={({ item: user }) => (
          <View style={styles.userCard}>
            <View>
              <Text style={styles.userEmail}>{user.email}</Text>
              <Text style={styles.currentRole}>Active Scope: <Text style={styles.bold}>{user.roleName}</Text></Text>
            </View>
            
            <View style={styles.actionsColumn}>
              {updatingUserId === user.id ? (
                <ActivityIndicator size="small" color="#0066cc" />
              ) : (
                roles.map((role) => (
                  <TouchableOpacity
                    key={role.id}
                    style={[styles.roleButton, user.roleName === role.name && styles.activeButton]}
                    onPress={() => handleRoleUpdate(user.id, role.id)}
                    disabled={user.roleName === role.name}
                  >
                    <Text style={styles.buttonText}>{role.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa', padding: 16 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16, color: '#212529' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  userCard: { backgroundColor: '#ffffff', padding: 16, borderRadius: 8, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  userEmail: { fontSize: 16, fontWeight: '600', color: '#495057' },
  currentRole: { fontSize: 13, color: '#6c757d', marginTop: 4 },
  bold: { fontWeight: 'bold', color: '#0066cc' },
  actionsColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '60%' },
  roleButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, backgroundColor: '#e9ecef' },
  activeButton: { backgroundColor: '#0066cc' },
  buttonText: { fontSize: 12, fontWeight: '500', color: '#212529' },
});