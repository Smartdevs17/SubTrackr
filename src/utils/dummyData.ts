import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

export const dummySubscriptions: Subscription[] = [
  {
    id: '1',
    name: 'Netflix',
    description: 'Premium streaming service with 4K content',
    category: SubscriptionCategory.STREAMING,
    price: 15.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '2',
    name: 'Spotify Premium',
    description: 'Ad-free music streaming with offline downloads',
    category: SubscriptionCategory.STREAMING,
    price: 9.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
    isActive: true,
    isCryptoEnabled: true,
    cryptoToken: 'USDC',
    cryptoAmount: 10,
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10'),
  },
  {
    id: '3',
    name: 'Adobe Creative Cloud',
    description: 'Professional design and creative software suite',
    category: SubscriptionCategory.SOFTWARE,
    price: 52.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2023-12-01'),
    updatedAt: new Date('2023-12-01'),
  },
  {
    id: '4',
    name: 'Notion Pro',
    description: 'Advanced note-taking and collaboration platform',
    category: SubscriptionCategory.PRODUCTIVITY,
    price: 8.00,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    isActive: true,
    isCryptoEnabled: true,
    cryptoToken: 'ETH',
    cryptoAmount: 0.005,
    createdAt: new Date('2024-01-20'),
    updatedAt: new Date('2024-01-20'),
  },
  {
    id: '5',
    name: 'Xbox Game Pass Ultimate',
    description: 'Access to hundreds of games and Xbox Live Gold',
    category: SubscriptionCategory.GAMING,
    price: 16.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2023-11-15'),
    updatedAt: new Date('2023-11-15'),
  },
  {
    id: '6',
    name: 'Peloton App',
    description: 'Fitness classes and workout tracking',
    category: SubscriptionCategory.FITNESS,
    price: 12.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
    isActive: true,
    isCryptoEnabled: true,
    cryptoToken: 'USDC',
    cryptoAmount: 13,
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-05'),
  },
  {
    id: '7',
    name: 'Coursera Plus',
    description: 'Unlimited access to online courses and certificates',
    category: SubscriptionCategory.EDUCATION,
    price: 399.00,
    currency: 'USD',
    billingCycle: BillingCycle.YEARLY,
    nextBillingDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '8',
    name: 'Mint Premium',
    description: 'Advanced financial tracking and budgeting tools',
    category: SubscriptionCategory.FINANCE,
    price: 4.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000), // 12 days from now
    isActive: false,
    isCryptoEnabled: false,
    createdAt: new Date('2023-10-01'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '9',
    name: 'Superfluid Stream',
    description: 'Decentralized streaming payment for Web3 services',
    category: SubscriptionCategory.OTHER,
    price: 0.001,
    currency: 'ETH',
    billingCycle: BillingCycle.CUSTOM,
    nextBillingDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    isActive: true,
    isCryptoEnabled: true,
    cryptoToken: 'ETH',
    cryptoAmount: 0.001,
    createdAt: new Date('2024-01-18'),
    updatedAt: new Date('2024-01-18'),
  },
  {
    id: '10',
    name: 'Discord Nitro',
    description: 'Enhanced Discord features and server boosts',
    category: SubscriptionCategory.OTHER,
    price: 9.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2023-12-20'),
    updatedAt: new Date('2023-12-20'),
  },
];

export const getUpcomingSubscriptions = (subscriptions: Subscription[]): Subscription[] => {
  if (!subscriptions || !Array.isArray(subscriptions)) {
    return [];
  }
  
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  return subscriptions
    .filter(sub => sub.isActive)
    .filter(sub => {
      const billingDate = new Date(sub.nextBillingDate);
      return billingDate >= today && billingDate <= nextWeek;
    })
    .sort((a, b) => new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime());
};

export const getTotalMonthlySpending = (subscriptions: Subscription[]): number => {
  if (!subscriptions || !Array.isArray(subscriptions)) {
    return 0;
  }
  
  return subscriptions
    .filter(sub => sub.isActive)
    .reduce((total, sub) => {
      let monthlyAmount = sub.price;
      
      switch (sub.billingCycle) {
        case BillingCycle.YEARLY:
          monthlyAmount = sub.price / 12;
          break;
        case BillingCycle.WEEKLY:
          monthlyAmount = sub.price * 4.33; // Average weeks per month
          break;
        case BillingCycle.CUSTOM:
          // For custom cycles, assume monthly for now
          monthlyAmount = sub.price;
          break;
        default:
          monthlyAmount = sub.price;
      }
      
      return total + monthlyAmount;
    }, 0);
};
