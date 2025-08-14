import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { useAppKit } from '@reown/appkit-ethers-react-native';
import walletServiceManager, { WalletConnection, TokenBalance } from '../services/walletService';

const WalletConnectScreen: React.FC = () => {
  const navigation = useNavigation();
  const { open } = useAppKit();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  useEffect(() => {
    initializeWalletService();
  }, []);

  // For now, we'll use a mock connection until we implement the full AppKit integration
  useEffect(() => {
    // This will be updated when we implement the full AppKit connection tracking
    console.log('Wallet connection status updated');
  }, []);

  useEffect(() => {
    if (connection) {
      loadTokenBalances();
    }
  }, [connection]);

  const initializeWalletService = async () => {
    try {
      await walletServiceManager.initialize();
      console.log('Wallet service initialized');
    } catch (error) {
      console.error('Failed to initialize wallet service:', error);
      Alert.alert('Error', 'Failed to initialize wallet service');
    }
  };

  const handleConnectWallet = async () => {
    try {
      setIsConnecting(true);
      open(); // Open the Reown AppKit modal
      
      // For demo purposes, simulate a connection after a delay
      setTimeout(() => {
        const mockConnection: WalletConnection = {
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
          chainId: 1,
          isConnected: true,
        };
        setConnection(mockConnection);
        walletServiceManager.setConnection(mockConnection);
        setIsConnecting(false);
      }, 3000);
    } catch (error) {
      console.error('Failed to open wallet modal:', error);
      Alert.alert('Error', 'Failed to open wallet modal. Please try again.');
      setIsConnecting(false);
    }
  };

  const handleDisconnectWallet = async () => {
    try {
      await walletServiceManager.disconnectWallet();
      setConnection(null);
      setTokenBalances([]);
      Alert.alert('Success', 'Wallet disconnected successfully!');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      Alert.alert('Error', 'Failed to disconnect wallet');
    }
  };

  const loadTokenBalances = async () => {
    if (!connection) return;
    
    try {
      setIsLoadingBalances(true);
      const balances = await walletServiceManager.getTokenBalances(
        connection.address,
        connection.chainId
      );
      setTokenBalances(balances);
    } catch (error) {
      console.error('Failed to load token balances:', error);
      Alert.alert('Error', 'Failed to load token balances');
    } finally {
      setIsLoadingBalances(false);
    }
  };

  const handleRefreshBalances = () => {
    loadTokenBalances();
  };

  const handleSetupCryptoPayments = () => {
    if (connection) {
      navigation.navigate('CryptoPayment' as never);
    } else {
      Alert.alert('Error', 'Please connect a wallet first');
    }
  };

  const formatAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getChainName = (chainId: number): string => {
    const chains: Record<number, string> = {
      1: 'Ethereum',
      137: 'Polygon',
      42161: 'Arbitrum',
    };
    return chains[chainId] || `Chain ${chainId}`;
  };

  const getChainColor = (chainId: number): string => {
    const chainColors: Record<number, string> = {
      1: '#627EEA', // Ethereum blue
      137: '#8247E5', // Polygon purple
      42161: '#28A0F0', // Arbitrum blue
    };
    return chainColors[chainId] || colors.primary;
  };

  const getChainDescription = (chainId: number): string => {
    const descriptions: Record<number, string> = {
      1: 'Mainnet - High security, higher fees',
      137: 'Polygon - Fast & cheap transactions',
      42161: 'Arbitrum - L2 scaling solution',
    };
    return descriptions[chainId] || 'Blockchain network';
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

  const getTokenPrice = (symbol: string): number => {
    const prices: Record<string, number> = {
      ETH: 3500,
      MATIC: 0.8,
      USDC: 1.0,
      ARB: 1.2,
    };
    return prices[symbol] || 1.0;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Connect Wallet</Text>
          <Text style={styles.subtitle}>
            Connect your Web3 wallet to enable crypto payments
          </Text>
        </View>

        {!connection ? (
          <View style={styles.connectSection}>
            <Card variant="elevated" padding="large">
              <View style={styles.connectHeader}>
                <Text style={styles.connectIcon}>🔗</Text>
                <Text style={styles.sectionTitle}>Connect Your Wallet</Text>
                <Text style={styles.sectionDescription}>
                  Choose from popular wallets like MetaMask, Trust Wallet, Rainbow, or Coinbase Wallet
                </Text>
              </View>
              
              <View style={styles.walletOptions}>
                <View style={styles.walletOption}>
                  <View style={styles.walletIconContainer}>
                    <Text style={styles.walletIcon}>🦊</Text>
                  </View>
                  <Text style={styles.walletName}>MetaMask</Text>
                  <Text style={styles.walletDescription}>Most Popular</Text>
                </View>
                <View style={styles.walletOption}>
                  <View style={styles.walletIconContainer}>
                    <Text style={styles.walletIcon}>🛡️</Text>
                  </View>
                  <Text style={styles.walletName}>Trust Wallet</Text>
                  <Text style={styles.walletDescription}>Mobile First</Text>
                </View>
                <View style={styles.walletOption}>
                  <View style={styles.walletIconContainer}>
                    <Text style={styles.walletIcon}>🌈</Text>
                  </View>
                  <Text style={styles.walletName}>Rainbow</Text>
                  <Text style={styles.walletDescription}>Beautiful UI</Text>
                </View>
                <View style={styles.walletOption}>
                  <View style={styles.walletIconContainer}>
                    <Text style={styles.walletIcon}>🪙</Text>
                  </View>
                  <Text style={styles.walletName}>Coinbase</Text>
                  <Text style={styles.walletDescription}>Exchange Wallet</Text>
                </View>
              </View>

              <View style={styles.connectButtonContainer}>
                <Button
                  title={isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  onPress={handleConnectWallet}
                  loading={isConnecting}
                  fullWidth
                  size="large"
                  variant="crypto"
                />
                <Text style={styles.connectNote}>
                  Tap to open wallet selection modal
                </Text>
              </View>
            </Card>
          </View>
        ) : (
          <View style={styles.connectedSection}>
            {/* Connection Status */}
            <Card variant="elevated" padding="large">
              <View style={styles.connectionHeader}>
                <View style={styles.connectionStatus}>
                  <View style={[styles.statusIndicator, { backgroundColor: colors.success }]} />
                  <Text style={styles.statusText}>Connected</Text>
                  <Text style={styles.connectionTime}>Just now</Text>
                </View>
                <TouchableOpacity 
                  style={styles.disconnectButton}
                  onPress={handleDisconnectWallet}
                >
                  <Text style={styles.disconnectIcon}>⏹️</Text>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.walletInfo}>
                <View style={styles.addressContainer}>
                  <Text style={styles.addressLabel}>Wallet Address</Text>
                  <TouchableOpacity style={styles.addressCopyButton}>
                    <Text style={styles.copyIcon}>📋</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.addressText}>{formatAddress(connection.address)}</Text>
                
                <View style={styles.chainInfo}>
                  <View style={[styles.chainBadge, { backgroundColor: getChainColor(connection.chainId) }]}>
                    <Text style={styles.chainIcon}>🔗</Text>
                    <Text style={styles.chainText}>{getChainName(connection.chainId)}</Text>
                  </View>
                  <Text style={styles.chainDescription}>
                    {getChainDescription(connection.chainId)}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Token Balances */}
            <Card variant="elevated" padding="large">
              <View style={styles.balancesHeader}>
                <View style={styles.balancesTitleContainer}>
                  <Text style={styles.balancesIcon}>💰</Text>
                  <Text style={styles.sectionTitle}>Token Balances</Text>
                </View>
                <TouchableOpacity 
                  style={styles.refreshButton}
                  onPress={handleRefreshBalances}
                >
                  <Text style={styles.refreshIcon}>🔄</Text>
                  <Text style={styles.refreshText}>Refresh</Text>
                </TouchableOpacity>
              </View>

              {isLoadingBalances ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.loadingText}>Loading balances...</Text>
                </View>
              ) : (
                <View style={styles.balancesList}>
                  {tokenBalances.map((token, index) => (
                    <View key={index} style={styles.balanceItem}>
                      <View style={styles.tokenInfo}>
                        <View style={styles.tokenIconContainer}>
                          <Text style={styles.tokenIcon}>{getTokenIcon(token.symbol)}</Text>
                        </View>
                        <View style={styles.tokenDetails}>
                          <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                          <Text style={styles.tokenName}>{token.name}</Text>
                        </View>
                      </View>
                      <View style={styles.balanceInfo}>
                        <Text style={styles.tokenBalance}>
                          {parseFloat(token.balance).toFixed(4)}
                        </Text>
                        <Text style={styles.tokenValue}>
                          ≈ ${(parseFloat(token.balance) * getTokenPrice(token.symbol)).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Crypto Payment Setup */}
            <Card variant="elevated" padding="large">
              <View style={styles.cryptoHeader}>
                <Text style={styles.cryptoIcon}>🌊</Text>
                <Text style={styles.sectionTitle}>Crypto Payments</Text>
                <Text style={styles.sectionDescription}>
                  Set up streaming payments using Superfluid or Sablier protocols
                </Text>
              </View>
              
              <View style={styles.protocolInfo}>
                <View style={styles.protocolItem}>
                  <Text style={styles.protocolIcon}>🌊</Text>
                  <Text style={styles.protocolName}>Superfluid</Text>
                  <Text style={styles.protocolDesc}>Continuous streaming</Text>
                </View>
                <View style={styles.protocolItem}>
                  <Text style={styles.protocolIcon}>⏰</Text>
                  <Text style={styles.protocolName}>Sablier</Text>
                  <Text style={styles.protocolDesc}>Time-locked streams</Text>
                </View>
              </View>
              
              <Button
                title="Setup Crypto Payments"
                onPress={handleSetupCryptoPayments}
                variant="crypto"
                fullWidth
                size="large"
              />
            </Card>
          </View>
        )}

        {/* Connection Status */}
        {!connection && (
          <Card variant="elevated" padding="large">
            <View style={styles.readyHeader}>
              <Text style={styles.readyIcon}>🔗</Text>
              <Text style={styles.sectionTitle}>Ready to Connect</Text>
              <Text style={styles.sectionDescription}>
                Tap the connect button to open your wallet and connect to SubTrackr
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  connectSection: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  connectedSection: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionDescription: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  connectHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  connectIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  walletOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  walletOption: {
    alignItems: 'center',
    minWidth: 80,
  },
  walletIconContainer: {
    width: 60,
    height: 60,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  walletIcon: {
    fontSize: 28,
  },
  walletName: {
    ...typography.caption,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  walletDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 10,
  },
  connectButtonContainer: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  connectNote: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  connectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: borderRadius.full,
    marginRight: spacing.sm,
  },
  statusText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  connectionTime: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
  },
  disconnectIcon: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  disconnectText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  walletInfo: {
    marginBottom: spacing.md,
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  addressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  addressCopyButton: {
    padding: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
  },
  copyIcon: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  addressText: {
    ...typography.h3,
    color: colors.text,
    fontFamily: 'monospace',
    marginBottom: spacing.md,
  },
  chainInfo: {
    alignItems: 'flex-start',
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.xs,
  },
  chainIcon: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  chainText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  chainDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },
  balancesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  balancesTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balancesIcon: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  refreshIcon: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  refreshText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  balancesList: {
    gap: spacing.sm,
  },
  balanceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  tokenInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    ...shadows.sm,
  },
  tokenIcon: {
    fontSize: 20,
  },
  tokenDetails: {
    flex: 1,
  },
  tokenSymbol: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  tokenName: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  balanceInfo: {
    alignItems: 'flex-end',
  },
  tokenBalance: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  tokenValue: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  setupButton: {
    marginTop: spacing.md,
  },
  cryptoHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  cryptoIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  protocolInfo: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  protocolItem: {
    alignItems: 'center',
    flex: 1,
  },
  protocolIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  protocolName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  protocolDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 10,
  },
  readyHeader: {
    alignItems: 'center',
  },
  readyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },

});

export default WalletConnectScreen;
