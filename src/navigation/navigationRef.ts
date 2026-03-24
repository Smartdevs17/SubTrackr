import { createNavigationContainerRef } from '@react-navigation/native';

import type { TabParamList } from './types';

export const navigationRef = createNavigationContainerRef<TabParamList>();
