import AsyncStorage from '@react-native-async-storage/async-storage';

const LINKED_WALLETS_KEY = '@subtrackr_linked_wallets';

export interface Web3AuthUser {
  id: string;
  email?: string;
  name?: string;
}

export interface Web3AuthAdapter {
  login(provider: 'google' | 'apple' | 'email'): Promise<{ user: Web3AuthUser; token: string }>;
  logout(): Promise<void>;
}

export const isWalletAddress = (address: string): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(address) || /^G[A-Z2-7]{55}$/.test(address);

/** Provider-neutral Web3Auth flow; the native SDK is injected by the app shell. */
export const web3Auth = {
  async signIn(adapter: Web3AuthAdapter, provider: 'google' | 'apple' | 'email') {
    return adapter.login(provider);
  },

  async linkWallet(userId: string, address: string): Promise<string[]> {
    if (!userId) throw new Error('A signed-in user is required');
    if (!isWalletAddress(address)) throw new Error('Invalid wallet address');
    const raw = await AsyncStorage.getItem(LINKED_WALLETS_KEY);
    const linked = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const wallets = Array.from(new Set([...(linked[userId] ?? []), address]));
    linked[userId] = wallets;
    await AsyncStorage.setItem(LINKED_WALLETS_KEY, JSON.stringify(linked));
    return wallets;
  },

  async getLinkedWallets(userId: string): Promise<string[]> {
    const raw = await AsyncStorage.getItem(LINKED_WALLETS_KEY);
    const linked = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return linked[userId] ?? [];
  },
};
