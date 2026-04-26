import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { errorHandler, ErrorType, ErrorSeverity, AppError } from '../services/errorHandler';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

type ErrorDashboardNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ErrorDashboardScreen: React.FC = () => {
  const navigation = useNavigation<ErrorDashboardNavigationProp>();

  const errorStats = useMemo(() => errorHandler.getErrorStats(), []);
  const recentErrors = errorStats.recent;

  const getSeverityColor = (severity: ErrorSeverity) => {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return colors.error;
      case ErrorSeverity.HIGH:
        return '#dc2626'; // Red-600
      case ErrorSeverity.MEDIUM:
        return colors.warning;
      case ErrorSeverity.LOW:
        return '#6b7280'; // Gray-500
      default:
        return colors.error;
    }
  };

  const getTypeColor = (type: ErrorType) => {
    switch (type) {
      case ErrorType.VALIDATION:
        return colors.warning;
      case ErrorType.NETWORK:
        return '#3b82f6'; // Blue-500
      case ErrorType.CRYPTO:
        return colors.accent;
      case ErrorType.STORAGE:
        return '#8b5cf6'; // Purple-500
      default:
        return colors.error;
    }
  };

  const renderErrorItem = ({ item }: { item: AppError }) => (
    <TouchableOpacity style={styles.errorItem}>
      <View style={styles.errorHeader}>
        <Text style={[styles.errorType, { color: getTypeColor(item.type) }]}>
          {item.type.toUpperCase()}
        </Text>
        <Text style={[styles.errorSeverity, { color: getSeverityColor(item.severity) }]}>
          {item.severity.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.errorMessage}>{item.userMessage}</Text>
      <Text style={styles.errorTimestamp}>{item.context.timestamp.toLocaleString()}</Text>
      {item.context.component && (
        <Text style={styles.errorComponent}>Component: {item.context.component}</Text>
      )}
    </TouchableOpacity>
  );

  const renderStatCard = (title: string, value: number, color: string) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Error Dashboard</Text>
          <Text style={styles.subtitle}>Monitor and track application errors</Text>
        </View>

        {/* Statistics Cards */}
        <View style={styles.statsContainer}>
          {renderStatCard('Total Errors', errorStats.total, colors.error)}
          {renderStatCard(
            'Critical',
            errorStats.bySeverity[ErrorSeverity.CRITICAL] || 0,
            colors.error
          )}
          {renderStatCard(
            'High Priority',
            errorStats.bySeverity[ErrorSeverity.HIGH] || 0,
            '#dc2626'
          )}
          {renderStatCard(
            'Validation',
            errorStats.byType[ErrorType.VALIDATION] || 0,
            colors.warning
          )}
          {renderStatCard('Network', errorStats.byType[ErrorType.NETWORK] || 0, '#3b82f6')}
          {renderStatCard('Crypto', errorStats.byType[ErrorType.CRYPTO] || 0, colors.accent)}
        </View>

        {/* Recent Errors */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Errors</Text>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => {
                errorHandler.clearErrors();
                // Force re-render by triggering navigation
                navigation.goBack();
                setTimeout(() => navigation.navigate('ErrorDashboard'), 100);
              }}>
              <Text style={styles.clearButtonText}>Clear All</Text>
            </TouchableOpacity>
          </View>

          {recentErrors.length > 0 ? (
            <FlatList
              data={recentErrors}
              renderItem={renderErrorItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No errors recorded</Text>
              <Text style={styles.emptyStateSubtext}>
                Errors will appear here when they occur in the app
              </Text>
            </View>
          )}
        </View>

        {/* Error Type Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Error Types</Text>
          {Object.entries(errorStats.byType).map(([type, count]) => (
            <View key={type} style={styles.typeBreakdown}>
              <Text style={[styles.typeName, { color: getTypeColor(type as ErrorType) }]}>
                {type}
              </Text>
              <Text style={styles.typeCount}>{count}</Text>
            </View>
          ))}
        </View>
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
    alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    margin: '1%',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: 'bold',
  },
  statTitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
  },
  clearButton: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  clearButtonText: {
    color: colors.text,
    ...typography.body,
    fontWeight: '600',
  },
  errorItem: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  errorType: {
    ...typography.body,
    fontWeight: '600',
    fontSize: 12,
  },
  errorSeverity: {
    ...typography.body,
    fontWeight: '600',
    fontSize: 12,
  },
  errorMessage: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorTimestamp: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
  },
  errorComponent: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyStateText: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyStateSubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  typeBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginVertical: spacing.xs,
  },
  typeName: {
    ...typography.body,
    fontWeight: '600',
  },
  typeCount: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

export default ErrorDashboardScreen;
