import React, { useState, useEffect } from 'react';
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
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { SubscriptionCategory, BillingCycle, SubscriptionFormData } from '../types/subscription';
import { useSubscriptionStore } from '../store';
import { Button } from '../components/common/Button';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { errorHandler } from '../services/errorHandler';

interface AddSubscriptionFormData extends SubscriptionFormData {
  priceError: string;
}

const AddSubscriptionScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { addSubscription, isLoading, error } = useSubscriptionStore();

  const [formData, setFormData] = useState<AddSubscriptionFormData>({
    name: '',
    description: '',
    category: SubscriptionCategory.OTHER,
    price: 0,
    priceError: '',
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(),
    notificationsEnabled: true,
    isCryptoEnabled: false,
    cryptoToken: undefined,
    cryptoAmount: undefined,
  });

  useEffect(() => {
    if (error) {
      Alert.alert('Error', error.userMessage);
      // Clear the error after showing it
      // Note: In a real app, you might want to clear errors in the store
    }
  }, [error]);

  // Date Picker States
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [selectedCategory, setSelectedCategory] = useState<SubscriptionCategory>(
    SubscriptionCategory.OTHER
  );
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<BillingCycle>(
    BillingCycle.MONTHLY
  );

  const handleCategorySelect = (category: SubscriptionCategory) => {
    setSelectedCategory(category);
    setFormData((prev) => ({ ...prev, category }));
  };

  const handleBillingCycleSelect = (cycle: BillingCycle) => {
    setSelectedBillingCycle(cycle);
    setFormData((prev) => ({ ...prev, billingCycle: cycle }));
  };

  const handleInputChange = (
    field: keyof AddSubscriptionFormData,
    value: string | number | boolean | Date
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      setShowPicker(false);
      return;
    }

    if (selectedDate) {
      handleInputChange('nextBillingDate', selectedDate);

      if (Platform.OS === 'android' && pickerMode === 'date') {
        setShowPicker(false);
        setTimeout(() => {
          setPickerMode('time');
          setShowPicker(true);
        }, 100);
      } else if (Platform.OS === 'android' && pickerMode === 'time') {
        setShowPicker(false);
        setPickerMode('date');
      }
    }
  };

  const showPickerHandler = () => {
    setPickerMode('date');
    setShowPicker(true);
  };

  const handleSubmit = async () => {
    // Client-side validation
    if (!formData.name.trim()) {
      const validationError = new Error('Subscription name is required');
      const appError = errorHandler.handleError(validationError, {
        action: 'validateSubscription',
        component: 'AddSubscriptionScreen',
      });
      Alert.alert('Validation Error', appError.userMessage);
      return;
    }

    if (
      formData.priceError ||
      !formData.price ||
      formData.price <= 0 ||
      Number.isNaN(formData.price)
    ) {
      const validationError = new Error(
        formData.priceError || 'Invalid price: must be greater than 0'
      );
      const appError = errorHandler.handleError(validationError, {
        action: 'validateSubscription',
        component: 'AddSubscriptionScreen',
      });
      Alert.alert('Validation Error', appError.userMessage);
      return;
    }

    try {
      await addSubscription(formData);

      if (formData.isCryptoEnabled) {
        Alert.alert(
          'Success!',
          'Subscription added successfully! Would you like to set up crypto payments now?',
          [
            { text: 'Later', onPress: () => navigation.goBack() },
            {
              text: 'Setup Crypto',
              onPress: () => navigation.navigate('CryptoPayment', { subscriptionId: 'new' }),
            },
          ]
        );
      } else {
        Alert.alert('Success', 'Subscription added successfully!', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error) {
      // Error is already handled in the store, but we can show additional UI feedback
      if (error) {
        Alert.alert('Error', 'Failed to add subscription. Please try again.');
      }
    }
  };

  const handleCancel = () => {
    if (
      formData.name.trim() ||
      (formData.description && formData.description.trim()) ||
      formData.price > 0
    ) {
      Alert.alert('Discard Changes', 'Are you sure you want to discard your changes?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
      ]);
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="add-subscription-screen">
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <TouchableOpacity
                onPress={handleCancel}
                style={styles.cancelButton}
                testID="cancel-add-subscription-button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.title} testID="subscription-form-title">
                Add Subscription
              </Text>
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
                  accessibilityLabel="Subscription name, required"
                  accessibilityHint="Enter the name of the subscription service"
                  returnKeyType="next"
                  testID="subscription-name-input"
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
                  accessibilityLabel="Description, optional"
                  accessibilityHint="Enter an optional description for this subscription"
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
                      selectedCategory === category && styles.categoryItemSelected,
                    ]}
                    onPress={() => handleCategorySelect(category)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={category.charAt(0).toUpperCase() + category.slice(1)}
                    accessibilityState={{ checked: selectedCategory === category }}>
                    <Text
                      style={[
                        styles.categoryText,
                        selectedCategory === category && styles.categoryTextSelected,
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
                      if (text.trim() === '') {
                        handleInputChange('priceError', '');
                        handleInputChange('price', 0);
                        return;
                      }
                      // Reject non-numeric input (allow digits, one dot, leading/trailing spaces)
                      if (!/^[\d.,\s]*$/.test(text.trim())) {
                        handleInputChange('priceError', 'Price must be a valid number');
                        return;
                      }
                      const normalized = text.replace(/,/g, '.').trim();
                      const numValue = parseFloat(normalized);
                      if (Number.isNaN(numValue)) {
                        handleInputChange('priceError', 'Price must be a valid number');
                      } else {
                        handleInputChange('priceError', '');
                      }
                      handleInputChange('price', numValue);
                    }}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Price, required"
                    accessibilityHint="Enter the subscription price"
                    testID="subscription-price-input"
                  />
                </View>
                {formData.priceError ? (
                  <Text style={styles.errorText}>{formData.priceError}</Text>
                ) : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Next Billing Date *</Text>
                <TouchableOpacity
                  style={styles.datePickerButton}
                  onPress={showPickerHandler}
                  accessibilityRole="button"
                  accessibilityLabel={`Next billing date, ${formData.nextBillingDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                  accessibilityHint="Opens date picker to select the next billing date">
                  <Text style={styles.datePickerText}>
                    {formData.nextBillingDate.toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Text>
                </TouchableOpacity>

                {showPicker && (
                  <DateTimePicker
                    value={formData.nextBillingDate}
                    mode={pickerMode}
                    is24Hour={true}
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onDateChange}
                    minimumDate={new Date()}
                  />
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Billing Cycle</Text>
                <View style={styles.billingCycleContainer}>
                  {Object.values(BillingCycle).map((cycle) => (
                    <TouchableOpacity
                      key={cycle}
                      style={[
                        styles.billingCycleItem,
                        selectedBillingCycle === cycle && styles.billingCycleItemSelected,
                      ]}
                      onPress={() => handleBillingCycleSelect(cycle)}
                      testID={`billing-cycle-option-${cycle}`}
                      accessibilityRole="radio"
                      accessibilityLabel={cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      accessibilityState={{ checked: selectedBillingCycle === cycle }}>
                      <Text
                        style={[
                          styles.billingCycleText,
                          selectedBillingCycle === cycle && styles.billingCycleTextSelected,
                        ]}>
                        {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notifications</Text>
              <View style={styles.cryptoOption}>
                <TouchableOpacity
                  style={styles.cryptoToggle}
                  onPress={() =>
                    handleInputChange(
                      'notificationsEnabled',
                      !(formData.notificationsEnabled !== false)
                    )
                  }
                  accessibilityRole="switch"
                  accessibilityLabel="Billing reminders and charge alerts"
                  accessibilityState={{ checked: formData.notificationsEnabled !== false }}>
                  <View
                    style={[
                      styles.toggleSwitch,
                      formData.notificationsEnabled !== false && styles.toggleSwitchActive,
                    ]}>
                    <View
                      style={[
                        styles.toggleKnob,
                        formData.notificationsEnabled !== false && styles.toggleKnobActive,
                      ]}
                    />
                  </View>
                </TouchableOpacity>
                <View style={styles.notificationLabelWrap}>
                  <Text style={styles.cryptoLabel}>Billing reminders & charge alerts</Text>
                  <Text style={styles.notificationHint}>
                    1 day before renewal (or 1 hour if sooner), plus charge success/failure
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Crypto Options</Text>
              <View style={styles.cryptoOption}>
                <TouchableOpacity
                  style={styles.cryptoToggle}
                  onPress={() => handleInputChange('isCryptoEnabled', !formData.isCryptoEnabled)}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable crypto payments"
                  accessibilityState={{ checked: formData.isCryptoEnabled }}>
                  <View
                    style={[
                      styles.toggleSwitch,
                      formData.isCryptoEnabled && styles.toggleSwitchActive,
                    ]}>
                    <View
                      style={[
                        styles.toggleKnob,
                        formData.isCryptoEnabled && styles.toggleKnobActive,
                      ]}
                    />
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
            testID="save-subscription-button"
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
  errorText: {
    color: colors.error || '#e74c3c',
    fontSize: 12,
    marginTop: spacing.xs,
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
  // Date picker styling
  datePickerButton: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  datePickerText: {
    ...typography.body,
    color: colors.text,
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
  notificationLabelWrap: {
    flex: 1,
    marginLeft: spacing.md,
  },
  notificationHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

export default AddSubscriptionScreen;
