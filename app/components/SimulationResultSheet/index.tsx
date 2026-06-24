import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SimulateTransactionDto, SimulationResponseDto, SimulationErrorCode } from '../../../shared/types/simulation';

interface Props {
  simulationResult: SimulationResponseDto | null;
  onConfirm: () => void;
  onCancel: () => void;
  isVisible: boolean;
}

export const SimulationResultSheet: React.FC<Props> = ({ simulationResult, onConfirm, onCancel, isVisible }) => {
  if (!isVisible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.sheet}>
        <Text style={styles.title}>Transaction Simulation</Text>

        <ScrollView style={styles.content}>
          {!simulationResult ? (
            <Text style={styles.warningText}>Simulating...</Text>
          ) : !simulationResult.success ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>Simulation Failed</Text>
              {simulationResult.predictedErrors?.map((err, i) => (
                <Text key={i} style={styles.errorText}>• {err}</Text>
              ))}
              {simulationResult.predictedErrors?.includes(SimulationErrorCode.NETWORK_ERROR) && (
                <Text style={styles.warningText}>
                  Simulation unavailable. Transaction can still be submitted, but may fail on-chain.
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.successContainer}>
              <Text style={styles.successTitle}>Simulation Successful</Text>

              <View style={styles.row}>
                <Text style={styles.label}>Expected Result:</Text>
                <Text style={styles.value}>{simulationResult.expectedResult?.status}</Text>
              </View>

              {simulationResult.gasEstimate && (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>Estimated Fee:</Text>
                    <Text style={styles.value}>{simulationResult.gasEstimate.estimatedFee} stroops</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>CPU Instructions:</Text>
                    <Text style={styles.value}>{simulationResult.gasEstimate.cpuInsns}</Text>
                  </View>
                </>
              )}

              {simulationResult.requiredAuth && simulationResult.requiredAuth.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Required Authorizations:</Text>
                  {simulationResult.requiredAuth.map((auth, i) => (
                    <Text key={i} style={styles.value}>• {auth.address} ({auth.role})</Text>
                  ))}
                </View>
              )}

              {simulationResult.stateDiff && simulationResult.stateDiff.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>State Changes:</Text>
                  {simulationResult.stateDiff.map((diff, i) => (
                    <Text key={i} style={styles.value}>• Contract {diff.contractId?.substring(0,8)}...</Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmButton, simulationResult && !simulationResult.success && !simulationResult.predictedErrors?.includes(SimulationErrorCode.NETWORK_ERROR) ? styles.disabledButton : null]}
            onPress={onConfirm}
            disabled={simulationResult ? (!simulationResult.success && !simulationResult.predictedErrors?.includes(SimulationErrorCode.NETWORK_ERROR)) : true}
          >
            <Text style={styles.confirmText}>Confirm & Sign</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  content: {
    marginBottom: 20,
  },
  errorContainer: {
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  errorTitle: {
    color: '#d32f2f',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorText: {
    color: '#d32f2f',
    marginBottom: 5,
  },
  warningText: {
    color: '#ed6c02',
    marginTop: 10,
    fontStyle: 'italic',
  },
  successContainer: {
    padding: 15,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
  },
  successTitle: {
    color: '#2e7d32',
    fontWeight: 'bold',
    marginBottom: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  label: {
    fontWeight: '600',
    color: '#555',
  },
  value: {
    color: '#333',
  },
  section: {
    marginTop: 15,
  },
  sectionTitle: {
    fontWeight: '600',
    marginBottom: 5,
    color: '#555',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    alignItems: 'center',
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  confirmButton: {
    flex: 1,
    padding: 15,
    alignItems: 'center',
    marginLeft: 10,
    borderRadius: 8,
    backgroundColor: '#1976d2',
  },
  disabledButton: {
    backgroundColor: '#9e9e9e',
  },
  cancelText: {
    color: '#333',
    fontWeight: 'bold',
  },
  confirmText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
