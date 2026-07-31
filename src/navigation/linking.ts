import * as Linking from 'expo-linking';
import { LinkingOptions } from '@react-navigation/native';

import { TabParamList } from './types';

const prefix = Linking.createURL('/');

export const linkingConfig: LinkingOptions<TabParamList> = {
  prefixes: [prefix, 'subtrackr://', 'https://subtrackr.app'],
  config: {
    screens: {
      HomeTab: {
        screens: {
          Home: '',
          AddSubscription: {
            path: 'subscription/add',
            parse: {
              amount: (amount: string) => Number.parseFloat(amount),
            },
          },
          SubscriptionDetail: 'subscription/:id',
          NotFound: '*',
        },
      },
      SettingsTab: {
        screens: {
          Settings: 'settings',
        },
      },
    },
  },
};
