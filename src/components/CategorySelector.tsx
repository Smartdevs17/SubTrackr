import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { useCategoryStore } from '../store/categoryStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { CustomCategory, CustomCategoryFormData } from '../types/subscription';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../utils/constants/categories';

interface CategorySelectorProps {
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  label?: string;
}

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  selectedCategoryId,
  onSelectCategory,
  label = 'Category',
}) => {
  const [modalVisible, setModalVisible] = useState(false);
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
  const selectedCategory = allCategories.find((c) => c.id === selectedCategoryId);

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

  const handleDeleteCategory = useCallback(
    (category: CustomCategory) => {
      const check = canDeleteCategory(category.id, subscriptions);
      if (!check.canDelete) {
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
            onPress: () => {
              deleteCategory(category.id, subscriptions);
            },
          },
        ]
      );
    },
    [canDeleteCategory, subscriptions, deleteCategory]
  );

  const handleReassignAndDelete = useCallback(
    (category: CustomCategory) => {
      const availableCategories = allCategories.filter((c) => c.id !== category.id);
      if (availableCategories.length === 0) {
        Alert.alert('Error', 'No other categories available to reassign subscriptions to.');
        return;
      }

      Alert.alert(
        'Reassign & Delete',
        `Subscriptions using "${category.name}" will be moved to "${availableCategories[0].name}".`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reassign & Delete',
            style: 'destructive',
            onPress: async () => {
              await reassignCategory(category.id, availableCategories[0].id);
              deleteCategory(category.id, useSubscriptionStore.getState().subscriptions);
            },
          },
        ]
      );
    },
    [allCategories, reassignCategory, deleteCategory]
  );

  const renderCategoryItem = useCallback(
    ({ item }: { item: CustomCategory }) => {
      const isSelected = item.id === selectedCategoryId;
      const isCustom = !item.isDefault;

      return (
        <TouchableOpacity
          style={[styles.categoryItem, isSelected && styles.categoryItemSelected]}
          onPress={() => {
            onSelectCategory(item.id);
            setModalVisible(false);
          }}
        >
          <View style={[styles.colorDot, { backgroundColor: item.color }]} />
          <Text style={styles.categoryName}>{item.name}</Text>
          {isSelected && <Text style={styles.checkMark}>✓</Text>}

          {isCustom && (
            <View style={styles.customActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => openEditModal(item)}
              >
                <Text style={styles.actionBtnText}>✎</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleDeleteCategory(item)}
              >
                <Text style={[styles.actionBtnText, styles.deleteText]}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedCategoryId, onSelectCategory, openEditModal, handleDeleteCategory]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.selectorButton}
        onPress={() => setModalVisible(true)}
      >
        {selectedCategory ? (
          <View style={styles.selectedRow}>
            <View
              style={[
                styles.selectedDot,
                { backgroundColor: selectedCategory.color },
              ]}
            />
            <Text style={styles.selectedText}>{selectedCategory.name}</Text>
          </View>
        ) : (
          <Text style={styles.placeholder}>Select a category...</Text>
        )}
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Category</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={allCategories}
              keyExtractor={(item) => item.id}
              renderItem={renderCategoryItem}
              contentContainerStyle={styles.listContent}
            />

            <TouchableOpacity style={styles.createBtn} onPress={openCreateModal}>
              <Text style={styles.createBtnText}>+ Create New Category</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
                  handleReassignAndDelete(editingCategory);
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
  container: { marginVertical: 8 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#333' },
  selectorButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center' },
  selectedDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  selectedText: { fontSize: 16, color: '#333' },
  placeholder: { fontSize: 16, color: '#999' },

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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeBtn: { fontSize: 20, color: '#666', padding: 4 },
  listContent: { paddingBottom: 12 },

  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  categoryItemSelected: { backgroundColor: '#E3F2FD' },
  colorDot: { width: 14, height: 14, borderRadius: 7, marginRight: 12 },
  categoryName: { flex: 1, fontSize: 16, color: '#333' },
  checkMark: { fontSize: 18, color: '#1E88E5', fontWeight: '700' },

  customActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { padding: 6, borderRadius: 6, backgroundColor: '#f5f5f5' },
  actionBtnText: { fontSize: 14 },
  deleteText: { color: '#E53935' },

  createBtn: {
    backgroundColor: '#1E88E5',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

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