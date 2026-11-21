import AsyncStorage from '@react-native-async-storage/async-storage';
import { isWalletAddress, web3Auth } from '../../../../mobile/src/auth/web3Auth';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('web3Auth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts EVM and Stellar public addresses only', () => {
    expect(isWalletAddress(`0x${'a'.repeat(40)}`)).toBe(true);
    expect(isWalletAddress(`G${'A'.repeat(55)}`)).toBe(true);
    expect(isWalletAddress('not-a-wallet')).toBe(false);
  });

  it('deduplicates linked wallets per social user', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ user: [] }));
    await expect(web3Auth.linkWallet('user', `0x${'a'.repeat(40)}`)).resolves.toHaveLength(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@subtrackr_linked_wallets',
      JSON.stringify({ user: [`0x${'a'.repeat(40)}`] }),
    );
  });
});
