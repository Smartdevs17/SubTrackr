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
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { RootStackParamList } from '../navigation/types';
import { useSubscriptionStore } from '../store';
import { Button } from '../components/common/Button';
import { getCurrencySymbol } from '../utils/formatting';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { BillingCycle, SubscriptionCategory } from '../types/subscription';
type EditSubscriptionRouteProp = RouteProp<RootStackParamList, 'EditSubscription'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const EditSubscriptionScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<EditSubscriptionRouteProp>();
  const { id } = route.params;

  const { subscriptions, updateSubscription, isLoading } = useSubscriptionStore();
  const subscription = subscriptions.find((s) => s.id === id);

  const [name, setName] = useState(subscription?.name ?? '');
  const [description, setDescription] = useState(subscription?.description ?? '');
  const [category, setCategory] = useState<SubscriptionCategory>(
    subscription?.category ?? SubscriptionCategory.OTHER
  );
  const [price, setPrice] = useState(subscription?.price.toString() ?? '0');
  const [priceError, setPriceError] = useState('');
  const [currency, setCurrency] = useState(subscription?.currency ?? 'USD');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    subscription?.billingCycle ?? BillingCycle.MONTHLY
  );
  const [nextBillingDate, setNextBillingDate] = useState(
    subscription ? new Date(subscription.nextBillingDate) : new Date()
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    subscription?.notificationsEnabled !== false
  );
  const [isCryptoEnabled, setIsCryptoEnabled] = useState(subscription?.isCryptoEnabled ?? false);
  const [cryptoToken, setCryptoToken] = useState(subscription?.cryptoToken ?? '');
  const [cryptoAmount, setCryptoAmount] = useState(subscription?.cryptoAmount?.toString() ?? '');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  if (!subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Subscription not found.</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    if (selectedDate) {
      setNextBillingDate(selectedDate);
      if (Platform.OS === 'android' && pickerMode === 'date') {
        setShowDatePicker(false);
        setTimeout(() => {
          setPickerMode('time');
          setShowDatePicker(true);
        }, 100);
      } else if (Platform.OS === 'android' && pickerMode === 'time') {
        setShowDatePicker(false);
        setPickerMode('date');
      }
    }
  };

  const handlePriceChange = (text: string) => {
    if (text.trim() === '') {
      setPriceError('');
      setPrice('');
      return;
    }
    if (!/^[\d.,\s]*$/.test(text.trim())) {
      setPriceError('Price must be a valid number');
      return;
    }
    setPriceError('');
    setPrice(text);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation Error', 'Subscription name is required.');
      return;
    }

    const parsedPrice = parseFloat(price.replace(/,/g, '.'));
    if (!price || Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Validation Error', priceError || 'Price must be greater than 0.');
      return;
    }

    // Warn if price changed and crypto stream exists (on-chain implications)
    const priceChanged = parsedPrice !== subscription.price;
    if (priceChanged && subscription.cryptoStreamId) {
      await new Promise<void>((resolve) => {
        Alert.alert(
          'Price Change Warning',
          'This subscription has an active on-chain crypto stream. Changing the price here updates the local record only — you may need to update the on-chain stream separately.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            { text: 'Continue', onPress: () => resolve() },
          ]
        );
      });
    }

    try {
      await updateSubscription(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        price: parsedPrice,
        currency,
        billingCycle,
        nextBillingDate,
        notificationsEnabled,
        isCryptoEnabled,
        cryptoToken: isCryptoEnabled && cryptoToken.trim() ? cryptoToken.trim() : undefined,
        cryptoAmount:
          isCryptoEnabled && cryptoAmount
            ? parseFloat(cryptoAmount.replace(/,/g, '.')) || undefined
            : undefined,
      });

      Alert.alert('Success', 'Subscription updated successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to update subscription. Please try again.');
    }
  };

  const handleCancel = () => {
    const isDirty =
      name !== subscription.name ||
      description !== (subscription.description ?? '') ||
      category !== subscription.category ||
      parseFloat(price) !== subscription.price ||
      currency !== subscription.currency ||
      billingCycle !== subscription.billingCycle;

    if (isDirty) {
      Alert.alert('Discard Changes', 'Are you sure you want to discard your changes?', [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
      ]);
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="edit-subscription-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={handleCancel}
                style={styles.cancelButton}
                testID="cancel-edit-button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Edit Subscription</Text>
              <View style={styles.placeholder} />
            </View>
            <Text style={styles.subtitle}>Update subscription details</Text>
          </View>

          <View style={styles.form}>
            {/* Basic Info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Basic Information</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Name *</Text>
                <TextInput
                  style={styles.textInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="Subscription name"
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                  returnKeyType="next"
                  accessibilityLabel="Subscription name, required"
                  testID="edit-name-input"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Description (Optional)</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Enter description"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  accessibilityLabel="Description, optional"
                />
              </View>
            </View>

            {/* Category */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Category</Text>
              <View style={styles.chipGrid}>
                {Object.values(SubscriptionCategory).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.chip, category === cat && styles.chipSelected]}
                    onPress={() => setCategory(cat)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={cat.charAt(0).toUpperCase() + cat.slice(1)}
                    accessibilityState={{ checked: category === cat }}>
                    <Text style={[styles.chipText, category === cat && styles.chipTextSelected]}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Billing Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Billing Details</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Price *</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.currencySymbol}>{getCurrencySymbol(currency)}</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={price}
                    onChangeText={handlePriceChange}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Price, required"
                    testID="edit-price-input"
                  />
                </View>
                {priceError ? <Text style={styles.errorText}>{priceError}</Text> : null}
                {subscription.cryptoStreamId ? (
                  <Text style={styles.hintText}>
                    ⚠️ On-chain stream exists — price changes apply locally only.
                  </Text>
                ) : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Currency</Text>
                <View style={styles.chipGrid}>
                  {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR'].map((cur) => (
                    <TouchableOpacity
                      key={cur}
                      style={[styles.chip, currency === cur && styles.chipSelected]}
                      onPress={() => setCurrency(cur)}
                      accessibilityRole="radio"
                      accessibilityLabel={cur}
                      accessibilityState={{ checked: currency === cur }}>
                      <Text style={[styles.chipText, currency === cur && styles.chipTextSelected]}>
                        {cur}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Next Billing Date *</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => {
                    setPickerMode('date');
                    setShowDatePicker(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Next billing date: ${nextBillingDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}>
                  <Text style={styles.dateButtonText}>
                    {nextBillingDate.toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={nextBillingDate}
                    mode={pickerMode}
                    is24Hour
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onDateChange}
                    minimumDate={new Date()}
                  />
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Billing Cycle</Text>
                <View style={styles.cycleRow}>
                  {Object.values(BillingCycle).map((cycle) => (
                    <TouchableOpacity
                      key={cycle}
                      style={[styles.cycleItem, billingCycle === cycle && styles.cycleItemSelected]}
                      onPress={() => setBillingCycle(cycle)}
                      accessibilityRole="radio"
                      accessibilityLabel={cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      accessibilityState={{ checked: billingCycle === cycle }}>
                      <Text
                        style={[
                          styles.cycleText,
                          billingCycle === cycle && styles.cycleTextSelected,
                        ]}>
                        {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Notifications */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notifications</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  onPress={() => setNotificationsEnabled((v) => !v)}
                  accessibilityRole="switch"
                  accessibilityLabel="Billing reminders and charge alerts"
                  accessibilityState={{ checked: notificationsEnabled }}>
                  <View style={[styles.toggle, notificationsEnabled && styles.toggleActive]}>
                    <View style={[styles.knob, notificationsEnabled && styles.knobActive]} />
                  </View>
                </TouchableOpacity>
                <View style={styles.toggleLabelWrap}>
                  <Text style={styles.toggleLabel}>Billing reminders & charge alerts</Text>
                  <Text style={styles.toggleHint}>
                    1 day before renewal (or 1 hour if sooner), plus charge success/failure
                  </Text>
                </View>
              </View>
            </View>

            {/* Crypto Options */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Crypto Options</Text>

              {subscription.cryptoStreamId ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    🔒 On-chain stream ID: {subscription.cryptoStreamId}
                  </Text>
                  <Text style={styles.infoSubText}>
                    Stream ID is immutable and cannot be changed here.
                  </Text>
                </View>
              ) : null}

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  onPress={() => setIsCryptoEnabled((v) => !v)}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable crypto payments"
                  accessibilityState={{ checked: isCryptoEnabled }}>
                  <View style={[styles.toggle, isCryptoEnabled && styles.toggleActive]}>
                    <View style={[styles.knob, isCryptoEnabled && styles.knobActive]} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.toggleLabel}>Enable crypto payments</Text>
              </View>

              {isCryptoEnabled && (
                <>
                  <View style={[styles.inputGroup, { marginTop: spacing.md }]}>
                    <Text style={styles.label}>Crypto Token</Text>
                    <TextInput
                      style={styles.textInput}
                      value={cryptoToken}
                      onChangeText={setCryptoToken}
                      placeholder="e.g. XLM, USDC"
                      placeholderTextColor={colors.textSecondary}
                      accessibilityLabel="Crypto token"
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Crypto Amount</Text>
                    <TextInput
                      style={styles.textInput}
                      value={cryptoAmount}
                      onChangeText={setCryptoAmount}
                      placeholder="0.00"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Crypto amount"
                    />
                  </View>
                </>
              )}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={isLoading}
            fullWidth
            size="large"
            testID="save-edit-button"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText: { ...typography.h3, color: colors.text, marginBottom: spacing.lg },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cancelButton: { padding: spacing.sm },
  cancelText: { ...typography.body, color: colors.primary, fontWeight: '500' },
  placeholder: { width: 60 },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  form: { padding: spacing.lg, paddingTop: 0 },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  inputGroup: { marginBottom: spacing.md },
  label: { ...typography.body, color: colors.text, marginBottom: spacing.xs, fontWeight: '500' },
  textInput: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  textArea: { height: 80, textAlignVertical: 'top' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  currencySymbol: { ...typography.h3, color: colors.textSecondary, marginRight: spacing.sm },
  priceInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.h3,
    fontWeight: '600',
  },
  errorText2: { color: colors.error || '#e74c3c', fontSize: 12, marginTop: spacing.xs },
  hintText: { ...typography.caption, color: colors.warning || '#f39c12', marginTop: spacing.xs },
  dateButton: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateButtonText: { ...typography.body, color: colors.text },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextSelected: { color: colors.text, fontWeight: '600' },
  cycleRow: { flexDirection: 'row', gap: spacing.sm },
  cycleItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cycleItemSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  cycleText: { ...typography.caption, color: colors.text },
  cycleTextSelected: { color: colors.text, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggle: {
    width: 50,
    height: 28,
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    padding: 2,
  },
  toggleActive: { backgroundColor: colors.primary },
  knob: { width: 24, height: 24, backgroundColor: colors.text, borderRadius: borderRadius.full },
  knobActive: { transform: [{ translateX: 22 }] },
  toggleLabelWrap: { flex: 1 },
  toggleLabel: { ...typography.body, color: colors.text },
  toggleHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  infoBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: { ...typography.body, color: colors.text },
  infoSubText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

export default EditSubscriptionScreen;
