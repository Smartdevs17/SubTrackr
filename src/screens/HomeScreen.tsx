import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { SubscriptionCard } from '../components/subscription/SubscriptionCard';
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { EmptyState } from '../components/common/EmptyState';
import { formatCurrencyCompact } from '../utils/formatting';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';