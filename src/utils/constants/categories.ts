import { SubscriptionCategory, CustomCategory } from '../../types/subscription';

export const MAX_CUSTOM_CATEGORIES = 20;

export const DEFAULT_CATEGORIES: CustomCategory[] = [
  {
    id: SubscriptionCategory.STREAMING,
    name: 'Streaming',
    icon: 'play-circle',
    color: '#E53935',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.SOFTWARE,
    name: 'Software',
    icon: 'code',
    color: '#1E88E5',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.GAMING,
    name: 'Gaming',
    icon: 'gamepad-2',
    color: '#8E24AA',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.PRODUCTIVITY,
    name: 'Productivity',
    icon: 'briefcase',
    color: '#43A047',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.FITNESS,
    name: 'Fitness',
    icon: 'dumbbell',
    color: '#FB8C00',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.EDUCATION,
    name: 'Education',
    icon: 'graduation-cap',
    color: '#00ACC1',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.FINANCE,
    name: 'Finance',
    icon: 'landmark',
    color: '#3949AB',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: SubscriptionCategory.OTHER,
    name: 'Other',
    icon: 'more-horizontal',
    color: '#757575',
    isDefault: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

export const CATEGORY_COLORS = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
  '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
  '#00897B', '#43A047', '#7CB342', '#C0CA33',
  '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  '#6D4C41', '#757575', '#546E7A', '#263238',
];

export const CATEGORY_ICONS = [
  'play-circle', 'code', 'gamepad-2', 'briefcase',
  'dumbbell', 'graduation-cap', 'landmark', 'more-horizontal',
  'music', 'film', 'tv', 'book-open',
  'shopping-bag', 'plane', 'heart', 'shield',
  'cloud', 'database', 'server', 'wifi',
  'smartphone', 'laptop', 'car', 'home',
  'coffee', 'utensils', 'palette', 'camera',
];