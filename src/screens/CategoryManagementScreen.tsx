import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useCategoryStore } from '../store/categoryStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { CustomCategory, CustomCategoryFormData } from '../types/subscription';
import { CategoryBadge } from '../components/CategoryBadge';
import { CATEGORY_COLORS, CATEGORY_ICONS, MAX_CUSTOM_CATEGORIES } from '../utils/constants/categories';

export const CategoryManagementScreen: React.FC = () => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(null);

  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState(CATEGORY_ICONS[0]);
  const [formColor, setFormColor] = useState(CATEGORY_COLORS[0]);

  const { customCategories, addCategory, updateCategory, deleteCategory, getAllCategories, canDeleteCategory } =
    useCategoryStore();
  const { subscriptions, reassignCategory } = useSubscriptionStore();

  const allCategories = getAllCategories();

  const resetForm = useCallback(() => {
    setFormName('');
    setFormIcon(CATEGORY_ICONS[0]);
    setFormColor(CATEGORY_COLORS[0]);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setCreateModalVisible(true);
  }, [resetForm]);

  const openEditModal = useCallback((category: CustomCategory) => {
    setEditingCategory(category);
    setFormName(category.name);
    setFormIcon(category.icon);
    setFormColor(category.color);
    setEditModalVisible(true);
  }, []);

  const handleCreateCategory = useCallback(() => {
    if (!formName.trim()) {
      Alert.alert('Error', 'Category name is required');
      return;
    }
    const data: CustomCategoryFormData = {
      name: formName.trim(),
      icon: formIcon,
      color: formColor,
    };
    addCategory(data);
    setCreateModalVisible(false);
    resetForm();
  }, [formName, formIcon, formColor, addCategory, resetForm]);

  const handleUpdateCategory = useCallback(() => {
    if (!editingCategory) return;
    if (!formName.trim()) {
      Alert.alert('Error', 'Category name is required');
      return;
    }
    const data: Partial<CustomCategoryFormData> = {
      name: formName.trim(),
      icon: formIcon,
      color: formColor,
    };
    updateCategory(editingCategory.id, data);
    setEditModalVisible(false);
    setEditingCategory(null);
    resetForm();
  }, [editingCategory, formName, formIcon, formColor, updateCategory, resetForm]);

  const handleDelete = useCallback(
    (category: CustomCategory) => {
      const check = canDeleteCategory(category.id, subscriptions);

      if (!check.canDelete) {
        if (check.reason?.includes('assigned')) {
          const available = allCategories.filter((c) => c.id !== category.id);
          if (available.length === 0) {
            Alert.alert('Cannot Delete', 'No other categories available to reassign to.');
            return;
          }
          Alert.alert(
            'Reassign Required',
            `Subscriptions are using "${category.name}". Reassign them to "${available[0].name}" and delete?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reassign & Delete',
                style: 'destructive',
                onPress: async () => {
                  await reassignCategory(category.id, available[0].id);
                  deleteCategory(category.id, useSubscriptionStore.getState().subscriptions);
                },
              },
            ]
          );
          return;
        }

        Alert.alert('Cannot Delete', check.reason || 'This category cannot be deleted');
        return;
      }

      Alert.alert(
        'Delete Category',
        `Are you sure you want to delete "${category.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteCategory(category.id, subscriptions),
          },
        ]
      );
    },
    [canDeleteCategory, subscriptions, allCategories, reassignCategory, deleteCategory]
  );

  const renderItem = useCallback(
    ({ item }: { item: CustomCategory }) => {
      const subCount = subscriptions.filter((s) => s.category === item.id).length;
      const isDefault = item.isDefault;

      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <CategoryBadge categoryId={item.id} size="lg" />
            <Text style={styles.subCount}>
              {subCount} subscription{subCount !== 1 ? 's' : ''}
            </Text>
          </View>

          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>
              {isDefault ? 'Built-in' : 'Custom'} • {item.icon}
            </Text>
          </View>

          {!isDefault && (
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => openEditModal(item)}
              >
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={() => handleDelete(item)}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    },
    [subscriptions, openEditModal, handleDelete]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Categories</Text>
        <Text style={styles.subtitle}>
          {customCategories.length} custom / {MAX_CUSTOM_CATEGORIES} max
        </Text>
      </View>

      <FlatList
        data={allCategories}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No categories found.</Text>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={openCreateModal}>
        <Text style={styles.fabText}>+ New Category</Text>
      </TouchableOpacity>

      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Category</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={formName}
              onChangeText={setFormName}
              placeholder="e.g. Photography"
              maxLength={30}
            />

            <Text style={styles.inputLabel}>Color</Text>
            <View style={styles.colorGrid}>
              {CATEGORY_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    formColor === color && styles.colorOptionSelected,
                  ]}
                  onPress={() => setFormColor(color)}
                />
              ))}
            </View>

            <Text style={styles.inputLabel}>Icon</Text>
            <View style={styles.iconGrid}>
              {CATEGORY_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    formIcon === icon && styles.iconOptionSelected,
                  ]}
                  onPress={() => setFormIcon(icon)}
                >
                  <Text style={styles.iconText}>{icon}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleCreateCategory}
              >
                <Text style={styles.saveBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Category</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={formName}
              onChangeText={setFormName}
              placeholder="Category name"
              maxLength={30}
            />

            <Text style={styles.inputLabel}>Color</Text>
            <View style={styles.colorGrid}>
              {CATEGORY_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    formColor === color && styles.colorOptionSelected,
                  ]}
                  onPress={() => setFormColor(color)}
                />
              ))}
            </View>

            <Text style={styles.inputLabel}>Icon</Text>
            <View style={styles.iconGrid}>
              {CATEGORY_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    formIcon === icon && styles.iconOptionSelected,
                  ]}
                  onPress={() => setFormIcon(icon)}
                >
                  <Text style={styles.iconText}>{icon}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleUpdateCategory}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            {editingCategory && !editingCategory.isDefault && (
              <TouchableOpacity
                style={styles.deleteCategoryBtn}
                onPress={() => {
                  setEditModalVisible(false);
                  handleDelete(editingCategory);
                }}
              >
                <Text style={styles.deleteCategoryText}>Delete Category</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    padding: 20,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#222' },
  subtitle: { fontSize: 13, color: '#888', marginTop: 4 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subCount: { fontSize: 13, color: '#888' },
  cardMeta: { marginBottom: 10 },
  metaText: { fontSize: 12, color: '#aaa' },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  actionText: { fontSize: 13, color: '#333', fontWeight: '500' },
  deleteBtn: { backgroundColor: '#FFEBEE' },
  deleteText: { color: '#C62828' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 15 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    backgroundColor: '#1E88E5',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    shadowColor: '#1E88E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 12 },

  inputLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginTop: 12, marginBottom: 6 },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    color: '#333',
  },

  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: '#222',
  },

  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconOptionSelected: {
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: '#1E88E5',
  },
  iconText: { fontSize: 12, color: '#555' },

  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  cancelBtn: { backgroundColor: '#f5f5f5' },
  saveBtn: { backgroundColor: '#1E88E5' },
  saveBtnText: { color: '#fff', fontWeight: '600' },

  deleteCategoryBtn: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  deleteCategoryText: { color: '#E53935', fontWeight: '600' },
});