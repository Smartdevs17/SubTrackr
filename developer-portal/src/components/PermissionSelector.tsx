import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ApiKeyPermission } from '../../../src/types/developerPortal';

interface PermissionSelectorProps {
  selectedPermissions: ApiKeyPermission[];
  onPermissionsChange: (permissions: ApiKeyPermission[]) => void;
}

const PERMISSIONS = [
  {
    value: ApiKeyPermission.READ,
    label: 'Read',
    description: 'View subscriptions and data',
    icon: '👁️',
  },
  {
    value: ApiKeyPermission.WRITE,
    label: 'Write',
    description: 'Create and update subscriptions',
    icon: '✏️',
  },
  {
    value: ApiKeyPermission.DELETE,
    label: 'Delete',
    description: 'Delete subscriptions and data',
    icon: '🗑️',
  },
  {
    value: ApiKeyPermission.ADMIN,
    label: 'Admin',
    description: 'Full access to all resources',
    icon: '👑',
  },
];

export const PermissionSelector: React.FC<PermissionSelectorProps> = ({
  selectedPermissions,
  onPermissionsChange,
}) => {
  const togglePermission = (permission: ApiKeyPermission) => {
    if (selectedPermissions.includes(permission)) {
      onPermissionsChange(selectedPermissions.filter((p) => p !== permission));
    } else {
      onPermissionsChange([...selectedPermissions, permission]);
    }
  };

  return (
    <View style={styles.container}>
      {PERMISSIONS.map((permission) => {
        const isSelected = selectedPermissions.includes(permission.value);
        return (
          <TouchableOpacity
            key={permission.value}
            style={[styles.permissionCard, isSelected && styles.permissionCardSelected]}
            onPress={() => togglePermission(permission.value)}>
            <View style={styles.permissionHeader}>
              <Text style={styles.permissionIcon}>{permission.icon}</Text>
              <View style={styles.permissionInfo}>
                <Text style={[styles.permissionLabel, isSelected && styles.permissionLabelSelected]}>
                  {permission.label}
                </Text>
                <Text style={styles.permissionDescription}>{permission.description}</Text>
              </View>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  permissionCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  permissionCardSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  permissionInfo: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  permissionLabelSelected: {
    color: '#007AFF',
  },
  permissionDescription: {
    fontSize: 14,
    color: '#666',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
