import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
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
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import walletServiceManager, {
  GasEstimate,
  WalletConnection,
  TokenBalance,
} from '../services/walletService';
import { ADDRESS_CONSTANTS } from '../utils/constants/values';
import { useTransactionQueueStore } from '../store/transactionQueueStore';

interface RouteParams {
  subscriptionId?: string;
}

const CryptoPaymentScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { subscriptionId } = (route.params as RouteParams) || {};

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
  // Approval workflow (ERC20 + Sablier)
  const [needsApproval, setNeedsApproval] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [approvalGas, setApprovalGas] = useState<GasEstimate | null>(null);
  const [approvalMode, setApprovalMode] = useState<'infinite' | 'exact'>('infinite');

  const [availableTokens, setAvailableTokens] = useState<TokenBalance[]>([]);
  const [connection, setConnection] = useState<WalletConnection | null>(null);

  const isOnline = useTransactionQueueStore((state) => state.isOnline);
  const isQueueProcessing = useTransactionQueueStore((state) => state.isProcessing);
  const queuedTransactions = useTransactionQueueStore((state) => state.queuedTransactions);
  const executeOrQueueTransaction = useTransactionQueueStore(
    (state) => state.executeOrQueueTransaction
  );

  const pendingCount = queuedTransactions.filter(
    (tx) => tx.status === 'pending' || tx.status === 'processing'
  ).length;

  useEffect(() => {
    loadWalletData();
  }, []);

  useEffect(() => {
    if (amount && recipientAddress && connection) {
      estimateGas();
    }
  }, [amount, recipientAddress, connection, selectedProtocol, selectedToken]);

  // Detect ERC20 allowance needs for Sablier and estimate approval gas
  useEffect(() => {
    const checkAllowance = async () => {
      try {
        setNeedsApproval(false);
        setApprovalGas(null);
        if (!isWalletConnected(connection)) return;
        if (selectedProtocol !== 'sablier') return;
        const tokenInfo = availableTokens.find((t) => t.symbol === selectedToken);
        if (
          !tokenInfo ||
          !tokenInfo.address ||
          tokenInfo.address === ethers.constants.AddressZero
        ) {
          return;
        }
        if (!amount || parseFloat(amount) <= 0) return;

        const owner = connection.address;
        const spender = ADDRESS_CONSTANTS.SABLIER_V2_LOCKUP_LINEAR;
        const allowance = await walletServiceManager.getErc20Allowance(
          tokenInfo.address,
          owner,
          spender,
          connection.chainId
        );
        const required = ethers.utils.parseUnits(amount, tokenInfo.decimals);
        const needs = allowance.lt(required);
        setNeedsApproval(needs);

        if (needs) {
          const approveAmount =
            approvalMode === 'infinite' ? ethers.constants.MaxUint256 : required;
          const gas = await walletServiceManager.estimateApproveGas(
            tokenInfo.address,
            spender,
            approveAmount,
            connection.chainId
          );
          setApprovalGas(gas);
        }
      } catch (err) {
        console.warn('Allowance check failed:', err);
        setNeedsApproval(false);
        setApprovalGas(null);
      }
    };

    checkAllowance();
  }, [selectedProtocol, selectedToken, amount, connection, availableTokens, approvalMode]);

  // Internal validation for type narrowing
  const isWalletConnected = (conn: WalletConnection | null): conn is WalletConnection => {
    return conn !== null && conn.isConnected;
  };

  const loadWalletData = async () => {
    try {
      const conn = walletServiceManager.getConnection();
      if (!conn || !conn.isConnected) {
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
    if (!isWalletConnected(connection) || !amount || !recipientAddress) return;

    try {
      if (selectedProtocol === 'superfluid') {
        const estimate = await walletServiceManager.estimateSuperfluidCreateFlow(
          selectedToken,
          amount,
          recipientAddress,
          connection.chainId
        );
        setGasEstimate(estimate);
      } else {
        const estimate = await walletServiceManager.estimateGas(
          connection.address,
          recipientAddress,
          amount,
          connection.chainId
        );
        setGasEstimate(estimate);
      }
    } catch (error) {
      console.error('Failed to estimate gas:', error);
      setGasEstimate(null);
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

    if (!recipientAddress || !ethers.utils.isAddress(recipientAddress)) {
      Alert.alert('Error', 'Please enter a valid Ethereum address');
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

    if (!isWalletConnected(connection)) {
      Alert.alert('Error', 'Wallet not connected');
      return;
    }

    try {
      setIsLoading(true);
      const selectedTokenInfo = availableTokens.find((token) => token.symbol === selectedToken);
      const tokenForExecution =
        selectedProtocol === 'sablier'
          ? (selectedTokenInfo?.address ?? selectedToken)
          : selectedToken;

      const startTime = Math.floor(Date.now() / 1000);
      const stopTime = startTime + 30 * 24 * 60 * 60;

      // If approval is required for Sablier ERC20, perform it first
      if (
        selectedProtocol === 'sablier' &&
        needsApproval &&
        selectedTokenInfo?.address &&
        selectedTokenInfo.address !== ethers.constants.AddressZero
      ) {
        setIsApproving(true);
        try {
          const approveAmount =
            approvalMode === 'infinite'
              ? ethers.constants.MaxUint256
              : ethers.utils.parseUnits(amount, selectedTokenInfo.decimals);
          const spender = ADDRESS_CONSTANTS.SABLIER_V2_LOCKUP_LINEAR;
          await walletServiceManager.approveErc20(
            selectedTokenInfo.address,
            spender,
            approveAmount
          );
        } finally {
          setIsApproving(false);
        }
      }

      const result = await executeOrQueueTransaction({
        protocol: selectedProtocol,
        token: tokenForExecution,
        amount,
        recipientAddress,
        chainId: connection.chainId,
        startTime,
        stopTime,
      });

      if (result.queued) {
        Alert.alert(
          'Queued',
          'You are offline or the network is unstable. Your transaction is queued and will run automatically when back online.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return;
      }

      const streamId = result.streamId ?? 'unknown';
      const txHash = result.txHash;

      const successBody =
        selectedProtocol === 'superfluid' && txHash
          ? `Stream created on-chain.\n\nTx hash:\n${txHash}\n\nStream ID (subgraph):\n${streamId}\n\nQuery the Superfluid subgraph using sender, receiver, and super token.`
          : `Stream created successfully!\nStream ID: ${streamId}`;

      Alert.alert('Success!', successBody, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error) {
      console.error('Failed to create stream:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to create stream. Please try again.';
      Alert.alert('Error', message);
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {subscriptionId ? 'Crypto Payment Setup' : 'Crypto Payment Configuration'}
            </Text>
            <Text style={styles.subtitle}>
              {subscriptionId
                ? 'Configure streaming payments for this subscription'
                : 'Set up crypto payment streams for your subscriptions'}
            </Text>
          </View>

          {!isOnline && (
            <Card variant="elevated" padding="large">
              <Text style={styles.offlineTitle}>Offline mode enabled</Text>
              <Text style={styles.offlineText}>
                Transactions are queued locally and sent automatically when your connection returns.
              </Text>
            </Card>
          )}

          {pendingCount > 0 && (
            <Card variant="elevated" padding="large">
              <Text style={styles.pendingTitle}>Pending transactions: {pendingCount}</Text>
              <Text style={styles.pendingText}>
                {isQueueProcessing
                  ? 'Processing queued transactions now.'
                  : 'Waiting for connectivity to process queued transactions.'}
              </Text>
            </Card>
          )}

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
                  accessibilityRole="radio"
                  accessibilityLabel={`${token.symbol}, balance ${parseFloat(token.balance).toFixed(4)}`}
                  accessibilityState={{ checked: selectedToken === token.symbol }}>
                  <Text style={styles.tokenIcon} accessibilityElementsHidden={true}>
                    {getTokenIcon(token.symbol)}
                  </Text>
                  <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                  <Text style={styles.tokenBalance}>{parseFloat(token.balance).toFixed(4)}</Text>
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
                accessibilityLabel={`Payment amount in ${selectedToken}`}
                accessibilityHint="Enter the amount to stream per payment cycle"
              />
            </View>
            <Text style={styles.amountDescription}>Amount to stream per payment cycle</Text>
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
              accessibilityLabel="Recipient wallet address"
              accessibilityHint="Enter the Ethereum address that will receive the payments"
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
                accessibilityRole="radio"
                accessibilityLabel="Superfluid, continuous streaming payments"
                accessibilityState={{ checked: selectedProtocol === 'superfluid' }}>
                <Text style={styles.protocolIcon} accessibilityElementsHidden={true}>
                  🌊
                </Text>
                <Text style={styles.protocolName}>Superfluid</Text>
                <Text style={styles.protocolDescription}>Continuous streaming payments</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.protocolOption,
                  selectedProtocol === 'sablier' && styles.protocolOptionSelected,
                ]}
                onPress={() => handleProtocolSelect('sablier')}
                accessibilityRole="radio"
                accessibilityLabel="Sablier, time-locked payment streams"
                accessibilityState={{ checked: selectedProtocol === 'sablier' }}>
                <Text style={styles.protocolIcon} accessibilityElementsHidden={true}>
                  ⏰
                </Text>
                <Text style={styles.protocolName}>Sablier</Text>
                <Text style={styles.protocolDescription}>Time-locked payment streams</Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Approval Step (Sablier ERC20) */}
          {selectedProtocol === 'sablier' && needsApproval && (
            <Card variant="elevated" padding="large">
              <Text style={styles.sectionTitle}>Token Approval Required</Text>
              <Text style={styles.pendingText}>
                Approve this token for the Sablier contract before creating the stream.
              </Text>

              <View style={{ height: spacing.sm }} />

              <View style={styles.protocolOptions}>
                <TouchableOpacity
                  style={[
                    styles.protocolOption,
                    approvalMode === 'infinite' && styles.protocolOptionSelected,
                  ]}
                  onPress={() => setApprovalMode('infinite')}>
                  <Text style={styles.protocolName}>Infinite approval</Text>
                  <Text style={styles.protocolDescription}>
                    Approve once for future streams with this token.
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.protocolOption,
                    approvalMode === 'exact' && styles.protocolOptionSelected,
                  ]}
                  onPress={() => setApprovalMode('exact')}>
                  <Text style={styles.protocolName}>Exact amount approval</Text>
                  <Text style={styles.protocolDescription}>
                    Approve only the exact amount for this stream.
                  </Text>
                </TouchableOpacity>
              </View>

              {approvalGas && (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.sectionTitle}>Approval Gas Estimate</Text>
                  <View style={styles.gasInfo}>
                    <View style={styles.gasRow}>
                      <Text style={styles.gasLabel}>Gas Limit:</Text>
                      <Text style={styles.gasValue}>{approvalGas.gasLimit}</Text>
                    </View>
                    <View style={styles.gasRow}>
                      <Text style={styles.gasLabel}>Gas Price:</Text>
                      <Text style={styles.gasValue}>{approvalGas.gasPrice} Gwei</Text>
                    </View>
                    <View style={styles.gasRow}>
                      <Text style={styles.gasLabel}>Estimated Cost:</Text>
                      <Text style={styles.gasValue}>
                        {parseFloat(approvalGas.estimatedCost).toFixed(6)}{' '}
                        {connection ? (connection.chainId === 137 ? 'MATIC' : 'ETH') : 'ETH'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={{ marginTop: spacing.md }}>
                <Button
                  title={isApproving ? 'Approving...' : 'Approve Token'}
                  onPress={async () => {
                    if (!isWalletConnected(connection)) return;
                    const tokenInfo = availableTokens.find((t) => t.symbol === selectedToken);
                    if (!tokenInfo?.address || tokenInfo.address === ethers.constants.AddressZero)
                      return;
                    setIsApproving(true);
                    try {
                      const approveAmount =
                        approvalMode === 'infinite'
                          ? ethers.constants.MaxUint256
                          : ethers.utils.parseUnits(amount || '0', tokenInfo.decimals);
                      await walletServiceManager.approveErc20(
                        tokenInfo.address,
                        ADDRESS_CONSTANTS.SABLIER_V2_LOCKUP_LINEAR,
                        approveAmount
                      );
                      setNeedsApproval(false);
                      setApprovalGas(null);
                      Alert.alert(
                        'Approved',
                        'Token approved successfully. You can now create the stream.'
                      );
                    } catch (e) {
                      const message =
                        e instanceof Error ? e.message : 'Token approval failed. Please try again.';
                      Alert.alert('Approval Failed', message);
                    } finally {
                      setIsApproving(false);
                    }
                  }}
                  loading={isApproving}
                  variant="crypto"
                  fullWidth
                  size="large"
                />
              </View>
            </Card>
          )}

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
              title={
                isLoading
                  ? 'Creating Stream...'
                  : isOnline
                    ? 'Create Payment Stream'
                    : 'Queue Payment Stream'
              }
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
  offlineTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  offlineText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  pendingTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  pendingText: {
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
