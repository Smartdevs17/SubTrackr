import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { useSegmentStore } from '../store/segmentStore';
import { useTheme } from '../theme/useTheme';
import { Button } from '../components/common/Button';
import { SegmentRuleBuilder } from '../components/segments/SegmentRuleBuilder';
import { SegmentRule, Segment } from '../types/segment';
import { useRoute, useNavigation } from '@react-navigation/native';

export const SegmentDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { segmentId } = route.params;
  const { segments, addSegment, updateSegment } = useSegmentStore();

  const isNew = segmentId === 'new';
  const existingSegment = segments.find((s) => s.id === segmentId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<SegmentRule[]>([]);
  const [discountPercentage, setDiscountPercentage] = useState('');

  useEffect(() => {
    if (existingSegment) {
      setName(existingSegment.name);
      setDescription(existingSegment.description);
      setLogic(existingSegment.logic);
      setRules(existingSegment.criteria);
      setDiscountPercentage(String(existingSegment.pricingRule?.discountPercentage || ''));
    }
  }, [existingSegment]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a segment name.');
      return;
    }

    const pricingRule = discountPercentage
      ? { discountPercentage: parseFloat(discountPercentage) }
      : undefined;

    const data = {
      name,
      description,
      logic,
      criteria: rules,
      pricingRule,
    };

    if (isNew) {
      addSegment(data);
    } else {
      updateSegment(segmentId, data);
    }

    navigation.goBack();
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Segment Name</Text>
        <TextInput
          style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. VIP Subscribers"
          placeholderTextColor={theme.colors.textSecondary}
        />

        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
          value={description}
          onChangeText={setDescription}
          placeholder="What defines this segment?"
          placeholderTextColor={theme.colors.textSecondary}
          multiline
          numberOfLines={3}
        />

        <SegmentRuleBuilder
          rules={rules}
          onChange={setRules}
          logic={logic}
          onLogicChange={setLogic}
        />

        <View style={styles.pricingSection}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Pricing Rules</Text>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Discount Percentage (%)</Text>
          <TextInput
            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
            value={discountPercentage}
            onChangeText={setDiscountPercentage}
            keyboardType="numeric"
            placeholder="e.g. 15"
            placeholderTextColor={theme.colors.textSecondary}
          />
        </View>

        <Button
          title={isNew ? 'Create Segment' : 'Save Changes'}
          onPress={handleSave}
          variant="primary"
          style={styles.saveButton}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  pricingSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  saveButton: {
    marginTop: 30,
    marginBottom: 50,
  },
});
