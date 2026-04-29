import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { colors, spacing, typography } from '../utils/constants';
import { RootStackParamList } from '../navigation/types';
import { useCancellationStore } from '../store/cancellationStore';

type Props = NativeStackScreenProps<RootStackParamList, 'CancellationFlow'>;

const CancellationFlowScreen: React.FC<Props> = ({ route, navigation }) => {
  const { currentStep, setReason, setStep, acceptOffer, reset } = useCancellationStore();

  const { subscriptionId } = route.params;

  useEffect(() => {
    return () => reset();
  }, [reset]);

  const handleFinalSuccess = () => {
    navigation.popToTop();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'REASON':
        return (
          <View>
            <Text style={styles.headerText}>Why are you leaving?</Text>
            {['Too Expensive', 'Switching to Competitor', 'Technical Issues'].map((r) => (
              <Button
                key={r}
                title={r}
                variant="secondary"
                onPress={() => setReason(r)}
                style={styles.btn}
              />
            ))}
          </View>
        );
      case 'OFFERS':
        return (
          <View>
            <Text style={styles.headerText}>Wait! We have a gift for you.</Text>
            <Card style={styles.offerCard}>
              <Text style={typography.body}>Get 20% off your next 3 months</Text>
              <Button title="Claim Discount" onPress={() => acceptOffer('DISCOUNT_20')} />
            </Card>
            <Button
              title="No thanks, continue to cancel"
              variant="secondary"
              onPress={() => setStep('CONFIRM')}
            />
          </View>
        );
      case 'CONFIRM':
        return (
          <View>
            <Text style={styles.headerText}>Are you sure?</Text>
            <Text style={styles.infoText}>
              Your access will continue until the end of the billing period.
            </Text>
            <Button
              title="Confirm Cancellation"
              variant="danger"
              onPress={() => setStep('SUCCESS')}
            />
          </View>
        );
      case 'SUCCESS':
        return (
          <View>
            <Text style={styles.headerText}>All set!</Text>
            <Text style={styles.infoText}>
              The request for subscription ID: {subscriptionId} has been processed successfully.
            </Text>
            <Button title="Back to Dashboard" onPress={handleFinalSuccess} />
          </View>
        );
      default:
        return null;
    }
  };

  return <ScrollView contentContainerStyle={styles.container}>{renderStep()}</ScrollView>;
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    flexGrow: 1,
    backgroundColor: colors.background,
  },
  headerText: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  infoText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  btn: {
    marginBottom: spacing.md,
  },
  offerCard: {
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
});

export default CancellationFlowScreen;
