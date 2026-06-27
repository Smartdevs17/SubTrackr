import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit-ethers-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import walletServiceManager, { WalletConnection, TokenBalance } from '../services/walletService';
import { useStore } from '../store';
import { RootStackParamList } from '../navigation/types';
import { getWalletConnectChain, WALLETCONNECT_CHAINS } from '../services/walletconnect/chains';
import {
  buildPairingUri,
  walletConnectSessionManager,
} from '../services/walletconnect/sessionManager';
import { WalletConnectSessionState } from '../services/walletconnect/types';

const WalletConnectV2Screen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider();
  const { syncWalletConnection, disconnect } = useStore();

  const previousConnectionRef = useRef(false);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(true);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [sessionState, setSessionState] = useState<WalletConnectSessionState | null>(null);

  useEffect(() => {
    void initializeWalletService();
    void hydrateSession();
  }, []);

  useEffect(() => {
    let active = true;

    const syncAppKitConnection = async () => {
      if (isConnected && address && walletProvider) {
        const nextConnection: WalletConnection = {
          address,
          chainId: chainId ?? 1,
          isConnected: true,
          eip1193Provider: walletProvider as unknown as WalletConnection['eip1193Provider'],
        };

        previousConnectionRef.current = true;
        walletServiceManager.setConnection(nextConnection);
        await syncWalletConnection({
          address,
          chainId: nextConnection.chainId,
          network: getChainName(nextConnection.chainId),
        });

        const nextSession = await walletConnectSessionManager.markConnected(
          address,
          nextConnection.chainId
        );
        const balances = await loadTokenBalances(nextConnection);

        if (!active) return;
        setConnection(nextConnection);
        setSessionState(nextSession);
        setTokenBalances(balances);
        setIsConnecting(false);
        return;
      }

      if (!isConnected && previousConnectionRef.current) {
        previousConnectionRef.current = false;
        await walletServiceManager.disconnectWallet();
        await disconnect();
        const nextSession =
          await walletConnectSessionManager.markDisconnected('wallet_session_closed');

        if (!active) return;
        setConnection(null);
        setTokenBalances([]);
        setSessionState(nextSession);
        setIsConnecting(false);
      }
    };

    void syncAppKitConnection().catch(async (error) => {
      console.error('Failed to sync WalletConnect session:', error);
      const nextSession = await walletConnectSessionManager.markError('walletconnect_sync_failed');
      if (!active) return;
      setSessionState(nextSession);
      setIsConnecting(false);
    });

    return () => {
      active = false;
    };
  }, [isConnected, address, chainId, walletProvider, syncWalletConnection, disconnect]);

  const initializeWalletService = async () => {
    try {
      await walletServiceManager.initialize();
    } catch (error) {
      console.error('Failed to initialize wallet service:', error);
      Alert.alert('Error', 'Failed to initialize wallet service');
    }
  };

  const hydrateSession = async () => {
    try {
      const restored = await walletConnectSessionManager.restore();
      setSessionState(restored);
    } finally {
      setIsHydratingSession(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      setIsConnecting(true);
      const connectingState = await walletConnectSessionManager.markConnecting();
      setSessionState(connectingState);
      open();
    } catch (error) {
      console.error('Failed to open wallet modal:', error);
      setIsConnecting(false);
      const nextSession = await walletConnectSessionManager.markError('walletconnect_open_failed');
      setSessionState(nextSession);
      Alert.alert('Error', 'Failed to open wallet modal. Please try again.');
    }
  };

  const handleDisconnectWallet = async () => {
    try {
      await walletServiceManager.disconnectWallet();
      await disconnect();
      setConnection(null);
      setTokenBalances([]);
      setSessionState(await walletConnectSessionManager.markDisconnected('user_disconnected'));
      previousConnectionRef.current = false;
      Alert.alert('Success', 'Wallet disconnected successfully.');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      setSessionState(
        await walletConnectSessionManager.markError('walletconnect_disconnect_failed')
      );
      Alert.alert('Error', 'Failed to disconnect wallet');
    }
  };

  const loadTokenBalances = async (
    nextConnection: WalletConnection | null = connection
  ): Promise<TokenBalance[]> => {
    if (!nextConnection) return [];

    try {
      setIsLoadingBalances(true);
      const balances = await walletServiceManager.getTokenBalances(
        nextConnection.address,
        nextConnection.chainId
      );
      return balances;
    } catch (error) {
      console.error('Failed to load token balances:', error);
      Alert.alert('Error', 'Failed to load token balances');
      return [];
    } finally {
      setIsLoadingBalances(false);
    }
  };

  const handleRefreshBalances = async () => {
    const balances = await loadTokenBalances();
    setTokenBalances(balances);
  };

  const handleCopyAddress = async () => {
    if (!connection?.address) return;

    try {
      await Clipboard.setStringAsync(connection.address);
      Alert.alert(Platform.OS === 'android' ? 'Copied' : 'Success', 'Address copied to clipboard');
    } catch (error) {
      console.error('Failed to copy address:', error);
      Alert.alert('Error', 'Failed to copy address to clipboard');
    }
  };

  const handleCopyPairingUri = async () => {
    try {
      await Clipboard.setStringAsync(pairingUri);
      Alert.alert('Copied', 'Pairing handoff copied to clipboard');
    } catch (error) {
      console.error('Failed to copy pairing URI:', error);
      Alert.alert('Error', 'Failed to copy pairing handoff');
    }
  };

  const handleSetupCryptoPayments = () => {
    if (connection) {
      navigation.navigate('CryptoPayment');
      return;
    }

    Alert.alert('Error', 'Please connect a wallet first');
  };

  const formatAddress = (value: string): string => `${value.slice(0, 6)}...${value.slice(-4)}`;

  const getChainName = (targetChainId: number): string =>
    getWalletConnectChain(targetChainId)?.name ?? `Chain ${targetChainId}`;

  const getChainColor = (targetChainId: number): string =>
    getWalletConnectChain(targetChainId)?.accentColor ?? colors.primary;

  const getChainDescription = (targetChainId: number): string =>
    getWalletConnectChain(targetChainId)?.description ?? 'Blockchain network';

  const getTokenIcon = (symbol: string): string => {
    const icons: Record<string, string> = {
      ETH: 'ETH',
      MATIC: 'POLY',
      USDC: 'USDC',
      ARB: 'ARB',
    };
    return icons[symbol] || symbol.slice(0, 4).toUpperCase();
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

  const pairingUri = useMemo(
    () => sessionState?.pairingUri || buildPairingUri(connection?.address, connection?.chainId),
    [sessionState?.pairingUri, connection?.address, connection?.chainId]
  );

  const statusColor = useMemo(() => {
    switch (sessionState?.status) {
      case 'connected':
        return colors.success;
      case 'connecting':
        return colors.accent;
      case 'error':
        return colors.error;
      case 'disconnected':
        return colors.warning;
      default:
        return colors.textSecondary;
    }
  }, [sessionState?.status]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Connect Wallet</Text>
          <Text style={styles.subtitle}>
            WalletConnect v2 session management with multi-chain handoff and recovery controls
          </Text>
        </View>

        <View style={styles.section}>
          <Card variant="elevated" padding="large">
            <View style={styles.statusHeader}>
              <View style={styles.statusRow}>
                <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
                <Text style={styles.statusText}>
                  {isHydratingSession ? 'Restoring session' : (sessionState?.status ?? 'idle')}
                </Text>
              </View>
              {sessionState?.connectedAt ? (
                <Text style={styles.sessionMetaText}>
                  Connected {new Date(sessionState.connectedAt).toLocaleString()}
                </Text>
              ) : null}
            </View>
            <Text style={styles.sectionDescription}>
              {sessionState?.lastError
                ? `Last error: ${sessionState.lastError}`
                : sessionState?.disconnectReason
                  ? `Disconnect reason: ${sessionState.disconnectReason}`
                  : 'Session state is persisted locally so reconnect flows are easier to recover.'}
            </Text>
            {sessionState?.sessionTopic ? (
              <Text style={styles.sessionMetaText}>Session topic: {sessionState.sessionTopic}</Text>
            ) : null}
          </Card>
        </View>

        <View style={styles.section}>
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>Supported chains</Text>
            <Text style={styles.sectionDescription}>
              WalletConnect v2 is configured for Ethereum, Polygon, Arbitrum, Optimism, and Base.
            </Text>
            <View style={styles.chainGrid}>
              {WALLETCONNECT_CHAINS.map((chain) => (
                <View
                  key={chain.chainId}
                  style={[styles.chainChip, { borderColor: chain.accentColor }]}>
                  <Text style={[styles.chainChipTitle, { color: chain.accentColor }]}>
                    {chain.name}
                  </Text>
                  <Text style={styles.chainChipDescription}>{chain.caipNetworkId}</Text>
                </View>
              ))}
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <Card variant="elevated" padding="large">
            <Text style={styles.sectionTitle}>QR handoff</Text>
            <Text style={styles.sectionDescription}>
              Scan or copy this WalletConnect v2 handoff payload to continue the same session setup
              on another device.
            </Text>
            <View style={styles.qrContainer}>
              <QRCode value={pairingUri} size={180} color={colors.text} backgroundColor="#ffffff" />
            </View>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleCopyPairingUri}>
              <Text style={styles.secondaryButtonText}>Copy pairing handoff</Text>
            </TouchableOpacity>
          </Card>
        </View>

        {!connection ? (
          <View style={styles.section}>
            <Card variant="elevated" padding="large">
              <View style={styles.connectHeader}>
                <Text style={styles.sectionTitle}>Connect your wallet</Text>
                <Text style={styles.sectionDescription}>
                  WalletConnect v2 will launch the modal with persisted connection state and the
                  configured chain set for better network switching.
                </Text>
              </View>

              <View style={styles.walletOptions}>
                {['MetaMask', 'Trust Wallet', 'Rainbow', 'Coinbase Wallet'].map((wallet) => (
                  <View key={wallet} style={styles.walletOption}>
                    <View style={styles.walletIconContainer}>
                      <Text style={styles.walletIcon}>{wallet.slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.walletName}>{wallet}</Text>
                  </View>
                ))}
              </View>

              <Button
                title={isConnecting ? 'Connecting...' : 'Connect Wallet'}
                onPress={handleConnectWallet}
                loading={isConnecting}
                fullWidth
                size="large"
                variant="crypto"
              />
              <Text style={styles.connectNote}>
                WalletConnect v2 pairing will remain visible here until the session is completed or
                cancelled.
              </Text>
            </Card>
          </View>
        ) : (
          <View style={styles.section}>
            <Card variant="elevated" padding="large">
              <View style={styles.connectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Connected session</Text>
                  <Text style={styles.sectionDescription}>
                    Session state, disconnect handling, and chain context are now persisted locally.
                  </Text>
                </View>
                <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnectWallet}>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.addressContainer}>
                <Text style={styles.addressLabel}>Wallet address</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={handleCopyAddress}>
                  <Text style={styles.secondaryButtonText}>Copy address</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.addressText}>{formatAddress(connection.address)}</Text>

              <View style={styles.chainInfo}>
                <View
                  style={[
                    styles.chainBadge,
                    { backgroundColor: getChainColor(connection.chainId) },
                  ]}>
                  <Text style={styles.chainText}>{getChainName(connection.chainId)}</Text>
                </View>
                <Text style={styles.chainDescription}>
                  {getChainDescription(connection.chainId)}
                </Text>
              </View>
            </Card>

            <Card variant="elevated" padding="large">
              <View style={styles.balancesHeader}>
                <Text style={styles.sectionTitle}>Token balances</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={handleRefreshBalances}>
                  <Text style={styles.secondaryButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>

              {isLoadingBalances ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.loadingText}>Loading balances...</Text>
                </View>
              ) : (
                <View style={styles.balancesList}>
                  {tokenBalances.map((token) => (
                    <View key={`${token.symbol}-${token.address}`} style={styles.balanceItem}>
                      <View style={styles.tokenInfo}>
                        <View style={styles.tokenIconContainer}>
                          <Text style={styles.tokenIcon}>{getTokenIcon(token.symbol)}</Text>
                        </View>
                        <View>
                          <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                          <Text style={styles.tokenName}>{token.name}</Text>
                        </View>
                      </View>
                      <View style={styles.balanceInfo}>
                        <Text style={styles.tokenBalance}>
                          {parseFloat(token.balance).toFixed(4)}
                        </Text>
                        <Text style={styles.tokenValue}>
                          ${(parseFloat(token.balance) * getTokenPrice(token.symbol)).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            <Card variant="elevated" padding="large">
              <Text style={styles.sectionTitle}>Crypto payments</Text>
              <Text style={styles.sectionDescription}>
                Continue into Superfluid or Sablier setup after the WalletConnect session is active.
              </Text>
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
  section: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionDescription: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  statusHeader: {
    marginBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
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
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  sessionMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chainGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chainChip: {
    width: '48%',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  chainChipTitle: {
    ...typography.body,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  chainChipDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  connectHeader: {
    marginBottom: spacing.md,
  },
  walletOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  walletOption: {
    width: '48%',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
  },
  walletIconContainer: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  walletIcon: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  walletName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  connectNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  connectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  disconnectButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.error,
  },
  disconnectText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  addressLabel: {
    ...typography.caption,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.xs,
  },
  chainText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  chainDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  balancesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  balancesList: {
    gap: spacing.sm,
  },
  balanceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  tokenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tokenIconContainer: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tokenIcon: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  tokenSymbol: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
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
    fontWeight: '700',
  },
  tokenValue: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

export default WalletConnectV2Screen;
