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
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import walletServiceManager, { TokenBalance, GasEstimate } from '../services/walletService';

interface RouteParams {
  subscriptionId?: string;
}

const CryptoPaymentScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { subscriptionId } = route.params as RouteParams || {};

  // Handle case when no subscriptionId is provided
  useEffect(() => {
    if (!subscriptionId) {
      console.log('No subscriptionId provided, proceeding with general crypto setup');
    }
  }, [subscriptionId]);

  const [selectedToken, setSelectedToken] = useState<string>('ETH');
  const [amount, setAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [selectedProtocol, setSelectedProtocol] = useState<'superfluid' | 'sablier'>('superfluid');
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEstimatingGas, setIsEstimatingGas] = useState(false);

  const [availableTokens, setAvailableTokens] = useState<TokenBalance[]>([]);
  const [connection, setConnection] = useState<any>(null);

  useEffect(() => {
    loadWalletData();
  }, []);

  useEffect(() => {
    if (amount && recipientAddress && connection) {
      estimateGas();
    }
  }, [amount, recipientAddress, connection]);

  const loadWalletData = async () => {
    try {
      const conn = walletServiceManager.getConnection();
      if (!conn) {
        Alert.alert('Error', 'Please connect a wallet first');
        navigation.goBack();
        return;
      }

      setConnection(conn);
      const balances = await walletServiceManager.getTokenBalances(conn.address, conn.chainId);
      setAvailableTokens(balances);
      
      // Set default recipient to connected wallet address
      setRecipientAddress(conn.address);
    } catch (error) {
      console.error('Failed to load wallet data:', error);
      Alert.alert('Error', 'Failed to load wallet data');
    }
  };

  const estimateGas = async () => {
    if (!connection || !amount || !recipientAddress) return;

    try {
      setIsEstimatingGas(true);
      const estimate = await walletServiceManager.estimateGas(
        connection.address,
        recipientAddress,
        amount,
        connection.chainId
      );
      setGasEstimate(estimate);
    } catch (error) {
      console.error('Failed to estimate gas:', error);
    } finally {
      setIsEstimatingGas(false);
    }
  };

  const handleTokenSelect = (tokenSymbol: string) => {
    setSelectedToken(tokenSymbol);
  };

  const handleProtocolSelect = (protocol: 'superfluid' | 'sablier') => {
    setSelectedProtocol(protocol);
  };

  const validateForm = (): boolean => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return false;
    }

    if (!recipientAddress || recipientAddress.length !== 42) {
      Alert.alert('Error', 'Please enter a valid recipient address');
      return false;
    }

    if (!selectedToken) {
      Alert.alert('Error', 'Please select a token');
      return false;
    }

    return true;
  };

  const handleCreateStream = async () => {
    if (!validateForm()) return;

    try {
      setIsLoading(true);
      let streamId: string;

      if (selectedProtocol === 'superfluid') {
        streamId = await walletServiceManager.createSuperfluidStream(
          selectedToken,
          amount,
          recipientAddress,
          connection.chainId
        );
      } else {
        const startTime = Math.floor(Date.now() / 1000);
        const stopTime = startTime + (30 * 24 * 60 * 60); // 30 days from now
        streamId = await walletServiceManager.createSablierStream(
          selectedToken,
          amount,
          startTime,
          stopTime,
          recipientAddress,
          connection.chainId
        );
      }

      Alert.alert(
        'Success!',
        `Stream created successfully!\nStream ID: ${streamId}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Failed to create stream:', error);
      Alert.alert('Error', 'Failed to create stream. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getTokenIcon = (symbol: string): string => {
    const icons: Record<string, string> = {
      ETH: '🔷',
      MATIC: '🟣',
      USDC: '💙',
      ARB: '🔵',
    };
    return icons[symbol] || '🪙';
  };

  const getProtocolDescription = (protocol: 'superfluid' | 'sablier'): string => {
    const descriptions = {
      superfluid: 'Continuous streaming payments with real-time settlement',
      sablier: 'Scheduled payments with time-locked streams',
    };
    return descriptions[protocol];
  };

  const getProtocolIcon = (protocol: 'superfluid' | 'sablier'): string => {
    return protocol === 'superfluid' ? '🌊' : '⏰';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {subscriptionId ? 'Crypto Payment Setup' : 'Crypto Payment Configuration'}
            </Text>
            <Text style={styles.subtitle}>
              {subscriptionId 
                ? 'Configure streaming payments for this subscription'
                : 'Set up crypto payment streams for your subscriptions'
              }
            </Text>
          </View>

          {/* Token Selection */}
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>Select Payment Token</Text>
            <View style={styles.tokenGrid}>
              {availableTokens.map((token, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.tokenOption,
                    selectedToken === token.symbol && styles.tokenOptionSelected,
                  ]}
                  onPress={() => handleTokenSelect(token.symbol)}
                >
                  <Text style={styles.tokenIcon}>{getTokenIcon(token.symbol)}</Text>
                  <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                  <Text style={styles.tokenBalance}>
                    {parseFloat(token.balance).toFixed(4)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Payment Amount */}
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>Payment Amount</Text>
            <View style={styles.amountInput}>
              <Text style={styles.currencySymbol}>{selectedToken}</Text>
              <TextInput
                style={styles.amountTextInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.amountDescription}>
              Amount to stream per payment cycle
            </Text>
          </Card>

          {/* Recipient Address */}
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>Recipient Address</Text>
            <TextInput
              style={styles.addressInput}
              value={recipientAddress}
              onChangeText={setRecipientAddress}
              placeholder="0x..."
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.addressDescription}>
              The address that will receive the payments
            </Text>
          </Card>

          {/* Protocol Selection */}
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>Payment Protocol</Text>
            <View style={styles.protocolOptions}>
              <TouchableOpacity
                style={[
                  styles.protocolOption,
                  selectedProtocol === 'superfluid' && styles.protocolOptionSelected,
                ]}
                onPress={() => handleProtocolSelect('superfluid')}
              >
                <Text style={styles.protocolIcon}>🌊</Text>
                <Text style={styles.protocolName}>Superfluid</Text>
                <Text style={styles.protocolDescription}>
                  Continuous streaming payments
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.protocolOption,
                  selectedProtocol === 'sablier' && styles.protocolOptionSelected,
                ]}
                onPress={() => handleProtocolSelect('sablier')}
              >
                <Text style={styles.protocolIcon}>⏰</Text>
                <Text style={styles.protocolName}>Sablier</Text>
                <Text style={styles.protocolDescription}>
                  Time-locked payment streams
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Gas Estimation */}
          {gasEstimate && (
            <Card variant="elevated" padding="large">
              <Text style={styles.sectionTitle}>Gas Estimation</Text>
              <View style={styles.gasInfo}>
                <View style={styles.gasRow}>
                  <Text style={styles.gasLabel}>Gas Limit:</Text>
                  <Text style={styles.gasValue}>{gasEstimate.gasLimit}</Text>
                </View>
                <View style={styles.gasRow}>
                  <Text style={styles.gasLabel}>Gas Price:</Text>
                  <Text style={styles.gasValue}>{gasEstimate.gasPrice} Gwei</Text>
                </View>
                <View style={styles.gasRow}>
                  <Text style={styles.gasLabel}>Estimated Cost:</Text>
                  <Text style={styles.gasValue}>
                    {parseFloat(gasEstimate.estimatedCost).toFixed(6)} {selectedToken}
                  </Text>
                </View>
              </View>
            </Card>
          )}

          {/* Create Stream Button */}
          <View style={styles.footer}>
            <Button
              title={isLoading ? 'Creating Stream...' : 'Create Payment Stream'}
              onPress={handleCreateStream}
              loading={isLoading}
              variant="crypto"
              fullWidth
              size="large"
            />
          </View>
        </ScrollView>
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
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  tokenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tokenOption: {
    flex: 1,
    minWidth: 100,
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tokenOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tokenIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  tokenSymbol: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  tokenBalance: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  amountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  currencySymbol: {
    ...typography.h2,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  amountTextInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.h2,
    fontWeight: '600',
  },
  amountDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  addressInput: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
    fontFamily: 'monospace',
    marginBottom: spacing.sm,
  },
  addressDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  protocolOptions: {
    gap: spacing.md,
  },
  protocolOption: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  protocolOptionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  protocolIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  protocolName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  protocolDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  gasInfo: {
    gap: spacing.sm,
  },
  gasRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gasLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  gasValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

export default CryptoPaymentScreen;
