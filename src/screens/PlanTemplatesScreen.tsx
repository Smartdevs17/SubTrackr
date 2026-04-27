import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PlanTemplate, TemplateFormData, PricingTier, TemplateValidationErrors } from '../types/template';

const BILLING_PERIODS = [
  { label: 'Daily', value: 86400 },
  { label: 'Weekly', value: 604800 },
  { label: 'Monthly', value: 2592000 },
  { label: 'Yearly', value: 31536000 },
];

const PlanTemplatesScreen: React.FC = () => {
  const {
    templates,
    templatesLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    fetchTemplates,
    computePreviewPrice,
  } = useSubscriptionStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>({
    name: '',
    basePrice: 0,
    billingPeriod: 2592000, // Monthly default
    tiers: [{ minQuantity: 1, discountBps: 0 }],
  });
  const [validationErrors, setValidationErrors] = useState<TemplateValidationErrors>({});
  const [previewQuantity, setPreviewQuantity] = useState(1);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const validateForm = (): boolean => {
    const errors: TemplateValidationErrors = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    if (formData.basePrice <= 0) {
      errors.basePrice = 'Base price must be positive';
    }

    if (formData.billingPeriod <= 0) {
      errors.billingPeriod = 'Billing period must be positive';
    }

    // Validate tiers
    const tierErrors: string[] = [];
    let lastMinQuantity = 0;

    for (let i = 0; i < formData.tiers.length; i++) {
      const tier = formData.tiers[i];

      if (tier.discountBps < 0 || tier.discountBps > 10000) {
        tierErrors.push(`Tier ${i + 1}: Discount must be 0-10000 bps`);
      }

      if (tier.minQuantity < lastMinQuantity) {
        tierErrors.push(`Tier ${i + 1}: Tiers must be sorted by quantity`);
      }

      if (tier.minQuantity === lastMinQuantity && i > 0) {
        tierErrors.push(`Tier ${i + 1}: Duplicate quantity`);
      }

      lastMinQuantity = tier.minQuantity;
    }

    if (tierErrors.length > 0) {
      errors.tiers = tierErrors;
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fix the errors before submitting');
      return;
    }

    try {
      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, formData);
        Alert.alert('Success', 'Template updated successfully');
      } else {
        await createTemplate(formData);
        Alert.alert('Success', 'Template created successfully');
      }
      resetForm();
    } catch (error) {
      Alert.alert('Error', 'Failed to save template');
    }
  };

  const handleDelete = (template: PlanTemplate) => {
    Alert.alert(
      'Delete Template',
      template.active
        ? `Are you sure you want to delete "${template.name}"?`
        : `This template will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTemplate(template.id);
              Alert.alert('Success', 'Template deleted');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete template');
            }
          },
        },
      ]
    );
  };

  const handleEdit = (template: PlanTemplate) => {
    setFormData({
      name: template.name,
      basePrice: template.basePrice,
      billingPeriod: template.billingPeriod,
      tiers: template.tiers,
    });
    setEditingTemplateId(template.id);
    setIsEditing(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      basePrice: 0,
      billingPeriod: 2592000,
      tiers: [{ minQuantity: 1, discountBps: 0 }],
    });
    setEditingTemplateId(null);
    setIsEditing(false);
    setValidationErrors({});
  };

  const addTier = () => {
    const lastTier = formData.tiers[formData.tiers.length - 1];
    setFormData({
      ...formData,
      tiers: [...formData.tiers, { minQuantity: lastTier.minQuantity + 10, discountBps: 0 }],
    });
  };

  const removeTier = (index: number) => {
    if (formData.tiers.length <= 1) {
      Alert.alert('Error', 'At least one tier is required');
      return;
    }
    const newTiers = formData.tiers.filter((_, i) => i !== index);
    setFormData({ ...formData, tiers: newTiers });
  };

  const updateTier = (index: number, field: keyof PricingTier, value: number) => {
    const newTiers = [...formData.tiers];
    newTiers[index] = { ...newTiers[index], [field]: value };
    setFormData({ ...formData, tiers: newTiers });
  };

  const renderTemplateItem = ({ item }: { item: PlanTemplate }) => (
    <View style={styles.templateCard}>
      <View style={styles.templateHeader}>
        <Text style={styles.templateName}>{item.name}</Text>
        <Text style={styles.versionBadge}>v{item.version}</Text>
      </View>

      <Text style={styles.templatePrice}>
        Base: {item.basePrice.toLocaleString()} stroops
      </Text>
      <Text style={styles.templatePeriod}>
        Billing: {BILLING_PERIODS.find((p) => p.value === item.billingPeriod)?.label || 'Custom'}
      </Text>

      <View style={styles.tiersContainer}>
        <Text style={styles.tiersTitle}>Pricing Tiers:</Text>
        {item.tiers.map((tier, index) => (
          <Text key={index} style={styles.tierText}>
            {tier.minQuantity}+ units: {(tier.discountBps / 100).toFixed(1)}% discount
          </Text>
        ))}
      </View>

      <View style={styles.templateActions}>
        <TouchableOpacity style={styles.editButton} onPress={() => handleEdit(item)}>
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteButton, !item.active && styles.inactiveButton]}
          onPress={() => handleDelete(item)}
        >
          <Text style={styles.deleteButtonText}>
            {item.active ? 'Delete' : 'Permanently Delete'}
          </Text>
        </TouchableOpacity>
      </View>

      {!item.active && (
        <Text style={styles.inactiveBadge}>Inactive</Text>
      )}
    </View>
  );

  if (isEditing || editingTemplateId) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>{editingTemplateId ? 'Edit Template' : 'Create Template'}</Text>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Template Name</Text>
            <TextInput
              style={[styles.input, validationErrors.name && styles.inputError]}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="Enter template name"
            />
            {validationErrors.name && (
              <Text style={styles.errorText}>{validationErrors.name}</Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Base Price (stroops)</Text>
            <TextInput
              style={[styles.input, validationErrors.basePrice && styles.inputError]}
              value={formData.basePrice.toString()}
              onChangeText={(text) =>
                setFormData({ ...formData, basePrice: parseFloat(text) || 0 })
              }
              placeholder="Enter base price"
              keyboardType="numeric"
            />
            {validationErrors.basePrice && (
              <Text style={styles.errorText}>{validationErrors.basePrice}</Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Billing Period</Text>
            {BILLING_PERIODS.map((period) => (
              <TouchableOpacity
                key={period.value}
                style={[
                  styles.periodButton,
                  formData.billingPeriod === period.value && styles.periodButtonActive,
                ]}
                onPress={() => setFormData({ ...formData, billingPeriod: period.value })}
              >
                <Text
                  style={[
                    styles.periodButtonText,
                    formData.billingPeriod === period.value && styles.periodButtonTextActive,
                  ]}
                >
                  {period.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Pricing Tiers</Text>
            {formData.tiers.map((tier, index) => (
              <View key={index} style={styles.tierRow}>
                <View style={styles.tierInput}>
                  <Text style={styles.tierLabel}>Min Qty:</Text>
                  <TextInput
                    style={styles.tierTextInput}
                    value={tier.minQuantity.toString()}
                    onChangeText={(text) =>
                      updateTier(index, 'minQuantity', parseInt(text) || 0)
                    }
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.tierInput}>
                  <Text style={styles.tierLabel}>Discount (bps):</Text>
                  <TextInput
                    style={styles.tierTextInput}
                    value={tier.discountBps.toString()}
                    onChangeText={(text) =>
                      updateTier(index, 'discountBps', parseInt(text) || 0)
                    }
                    keyboardType="numeric"
                  />
                </View>
                <TouchableOpacity
                  style={styles.removeTierButton}
                  onPress={() => removeTier(index)}
                >
                  <Text style={styles.removeTierText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {validationErrors.tiers &&
              validationErrors.tiers.map((error, index) => (
                <Text key={index} style={styles.errorText}>
                  {error}
                </Text>
              ))}
            <TouchableOpacity style={styles.addTierButton} onPress={addTier}>
              <Text style={styles.addTierText}>+ Add Tier</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Preview Price</Text>
            <View style={styles.previewContainer}>
              <TextInput
                style={styles.previewInput}
                value={previewQuantity.toString()}
                onChangeText={(text) => setPreviewQuantity(parseInt(text) || 0)}
                keyboardType="numeric"
              />
              <Text style={styles.previewText}>
                = {computePreviewPrice(editingTemplateId || 'temp', previewQuantity).toLocaleString()}{' '}
                stroops
              </Text>
            </View>
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitButtonText}>
                {editingTemplateId ? 'Update Template' : 'Create Template'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Plan Templates</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setIsEditing(true)}
        >
          <Text style={styles.createButtonText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {templatesLoading ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : templates.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No templates yet</Text>
          <Text style={styles.emptySubtext}>Create your first template to get started</Text>
        </View>
      ) : (
        <FlatList
          data={templates}
          renderItem={renderTemplateItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={templatesLoading}
          onRefresh={fetchTemplates}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loader: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#BBB',
  },
  listContent: {
    padding: 16,
  },
  templateCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  templateName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  versionBadge: {
    backgroundColor: '#E3F2FD',
    color: '#1976D2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: '600',
  },
  templatePrice: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  templatePeriod: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  tiersContainer: {
    backgroundColor: '#F9F9F9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  tiersTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  tierText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  templateActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  editButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  editButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  deleteButton: {
    flex: 1,
    backgroundColor: '#F44336',
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  inactiveButton: {
    backgroundColor: '#FF9800',
  },
  inactiveBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFCDD2',
    color: '#C62828',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: '600',
  },
  form: {
    padding: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputError: {
    borderColor: '#F44336',
  },
  errorText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
  },
  periodButton: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  periodButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  periodButtonText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
  periodButtonTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierInput: {
    flex: 1,
    marginRight: 8,
  },
  tierLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  tierTextInput: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  removeTierButton: {
    backgroundColor: '#F44336',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  removeTierText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addTierButton: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  addTierText: {
    color: '#1976D2',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
  },
  previewInput: {
    width: 80,
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 16,
    marginRight: 12,
  },
  previewText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  formActions: {
    marginTop: 24,
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#999',
    paddingVertical: 14,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default PlanTemplatesScreen;
