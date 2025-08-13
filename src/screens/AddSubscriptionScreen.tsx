import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  ScrollView, 
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { SubscriptionCategory, BillingCycle, SubscriptionFormData } from '../types/subscription';
import { useSubscriptionStore } from '../store';
import { Button } from '../components/common/Button';
import { formatCurrency } from '../utils/formatting';

export const AddSubscriptionScreen: React.FC = () => {
  const navigation = useNavigation();
  const { addSubscription, isLoading } = useSubscriptionStore();
  
  const [formData, setFormData] = useState<SubscriptionFormData>({
    name: '',
    description: '',
    category: SubscriptionCategory.OTHER,
    price: 0,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(),
    isCryptoEnabled: false,
    cryptoToken: undefined,
    cryptoAmount: undefined,
  });
  
  const [selectedCategory, setSelectedCategory] = useState<SubscriptionCategory>(SubscriptionCategory.OTHER);
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);

  const handleCategorySelect = (category: SubscriptionCategory) => {
    setSelectedCategory(category);
    setFormData(prev => ({ ...prev, category }));
  };

  const handleBillingCycleSelect = (cycle: BillingCycle) => {
    setSelectedBillingCycle(cycle);
    setFormData(prev => ({ ...prev, billingCycle: cycle }));
  };

  const handleInputChange = (field: keyof SubscriptionFormData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a subscription name');
      return;
    }
    
    if (formData.price <= 0) {
      Alert.alert('Error', 'Please enter a valid price');
      return;
    }

    try {
      await addSubscription(formData);
      Alert.alert(
        'Success', 
        'Subscription added successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to add subscription. Please try again.');
    }
  };

  const handleCancel = () => {
    if (formData.name.trim() || (formData.description && formData.description.trim()) || formData.price > 0) {
      Alert.alert(
        'Discard Changes',
        'Are you sure you want to discard your changes?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Add Subscription</Text>
              <View style={styles.placeholderButton} />
            </View>
            <Text style={styles.subtitle}>Track your new subscription</Text>
          </View>
          
          <View style={styles.form}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Basic Information</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Name *</Text>
                <TextInput
                  style={styles.textInput}
                  value={formData.name}
                  onChangeText={(text) => handleInputChange('name', text)}
                  placeholder="Enter subscription name"
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Description (Optional)</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={formData.description}
                  onChangeText={(text) => handleInputChange('description', text)}
                  placeholder="Enter description"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </View>
            
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Category</Text>
              <View style={styles.categoryGrid}>
                {Object.values(SubscriptionCategory).map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.categoryItem,
                      selectedCategory === category && styles.categoryItemSelected
                    ]}
                    onPress={() => handleCategorySelect(category)}
                  >
                    <Text style={[
                      styles.categoryText,
                      selectedCategory === category && styles.categoryTextSelected
                    ]}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Billing Details</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Price *</Text>
                <View style={styles.priceInputContainer}>
                  <Text style={styles.currencySymbol}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={formData.price > 0 ? formData.price.toString() : ''}
                    onChangeText={(text) => {
                      const numValue = parseFloat(text) || 0;
                      handleInputChange('price', numValue);
                    }}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Billing Cycle</Text>
                <View style={styles.billingCycleContainer}>
                  {Object.values(BillingCycle).map((cycle) => (
                    <TouchableOpacity
                      key={cycle}
                      style={[
                        styles.billingCycleItem,
                        selectedBillingCycle === cycle && styles.billingCycleItemSelected
                      ]}
                      onPress={() => handleBillingCycleSelect(cycle)}
                    >
                      <Text style={[
                        styles.billingCycleText,
                        selectedBillingCycle === cycle && styles.billingCycleTextSelected
                      ]}>
                        {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Crypto Options</Text>
              <View style={styles.cryptoOption}>
                <TouchableOpacity
                  style={styles.cryptoToggle}
                  onPress={() => handleInputChange('isCryptoEnabled', !formData.isCryptoEnabled)}
                >
                  <View style={[
                    styles.toggleSwitch,
                    formData.isCryptoEnabled && styles.toggleSwitchActive
                  ]}>
                    <View style={[
                      styles.toggleKnob,
                      formData.isCryptoEnabled && styles.toggleKnobActive
                    ]} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.cryptoLabel}>Enable crypto payments</Text>
              </View>
            </View>
          </View>
        </ScrollView>
        
        <View style={styles.footer}>
          <Button
            title="Add Subscription"
            onPress={handleSubmit}
            loading={isLoading}
            fullWidth
            size="large"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cancelButton: {
    padding: spacing.sm,
  },
  cancelText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '500',
  },
  placeholderButton: {
    width: 60,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  currencySymbol: {
    ...typography.h3,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  priceInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.h3,
    fontWeight: '600',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryText: {
    ...typography.caption,
    color: colors.text,
  },
  categoryTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  billingCycleContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  billingCycleItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  billingCycleItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  billingCycleText: {
    ...typography.caption,
    color: colors.text,
  },
  billingCycleTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  cryptoOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cryptoToggle: {
    padding: spacing.xs,
  },
  toggleSwitch: {
    width: 50,
    height: 28,
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    padding: 2,
  },
  toggleSwitchActive: {
    backgroundColor: colors.primary,
  },
  toggleKnob: {
    width: 24,
    height: 24,
    backgroundColor: colors.text,
    borderRadius: borderRadius.full,
  },
  toggleKnobActive: {
    transform: [{ translateX: 22 }],
  },
  cryptoLabel: {
    ...typography.body,
    color: colors.text,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
