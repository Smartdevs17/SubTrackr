import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useAnalyticsStore } from '../../../app/stores/analyticsStore';
import { spacing, typography, borderRadius } from '../../utils/constants';

interface WidgetCustomizationModalProps {
  visible: boolean;
  onClose: () => void;
}

const WIDGET_LABELS: Record<string, { title: string; description: string; icon: string }> = {
  overview: {
    title: 'MRR & ARR Overview',
    description: 'Key recurring revenue metrics and MoM growth rate badges',
    icon: '💰',
  },
  revenueTrend: {
    title: 'Historical Revenue Trend',
    description: '6-month MRR/ARR trajectory chart with anomaly detection',
    icon: '📈',
  },
  forecast: {
    title: 'Revenue Forecasting',
    description: 'Predictive 3-month trajectory with linear & exponential models',
    icon: '🔮',
  },
  cohortHeatmap: {
    title: 'Cohort Retention Heatmap',
    description: 'Customer lifecycle retention curves across monthly cohorts',
    icon: '🔥',
  },
  churnBreakdown: {
    title: 'Churn vs. Logo Breakdown',
    description: 'Comparison between revenue loss and subscriber churn',
    icon: '📉',
  },
  planMigrations: {
    title: 'Plan Migrations Flow',
    description: 'Sankey diagram visualizing plan upgrades and downgrades',
    icon: '🔀',
  },
};

export const WidgetCustomizationModal: React.FC<WidgetCustomizationModalProps> = ({
  visible,
  onClose,
}) => {
  const {
    enabledWidgets,
    widgetOrder,
    forecastModel,
    toggleWidget,
    reorderWidgets,
    setForecastModel,
    resetWidgetConfig,
  } = useAnalyticsStore();

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...widgetOrder];
    const temp = newOrder[index - 1];
    newOrder[index - 1] = newOrder[index];
    newOrder[index] = temp;
    reorderWidgets(newOrder);
  };

  const handleMoveDown = (index: number) => {
    if (index === widgetOrder.length - 1) return;
    const newOrder = [...widgetOrder];
    const temp = newOrder[index + 1];
    newOrder[index + 1] = newOrder[index];
    newOrder[index] = temp;
    reorderWidgets(newOrder);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Dashboard Customizer</Text>
              <Text style={styles.subtitle}>Configure analytics widgets & forecast models</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Forecast Model Selection Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔮 Revenue Forecasting Model</Text>
              <Text style={styles.sectionDesc}>
                Select the algorithmic model used to project future MRR and ARR trajectories.
              </Text>
              <View style={styles.modelSelectorContainer}>
                <TouchableOpacity
                  style={[
                    styles.modelOption,
                    forecastModel === 'exponential' && styles.modelOptionActive,
                  ]}
                  onPress={() => setForecastModel('exponential')}
                >
                  <Text
                    style={[
                      styles.modelOptionTitle,
                      forecastModel === 'exponential' && styles.modelOptionTitleActive,
                    ]}
                  >
                    Exponential Decay
                  </Text>
                  <Text
                    style={[
                      styles.modelOptionDesc,
                      forecastModel === 'exponential' && styles.modelOptionDescActive,
                    ]}
                  >
                    Compound retention & expansion rate model
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modelOption,
                    forecastModel === 'linear' && styles.modelOptionActive,
                  ]}
                  onPress={() => setForecastModel('linear')}
                >
                  <Text
                    style={[
                      styles.modelOptionTitle,
                      forecastModel === 'linear' && styles.modelOptionTitleActive,
                    ]}
                  >
                    Linear Regression
                  </Text>
                  <Text
                    style={[
                      styles.modelOptionDesc,
                      forecastModel === 'linear' && styles.modelOptionDescActive,
                    ]}
                  >
                    Trend-line slope based on recent months
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Widget Toggles & Order Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>🛠️ Widget Layout & Visibility</Text>
                <TouchableOpacity onPress={resetWidgetConfig} style={styles.resetButton}>
                  <Text style={styles.resetButtonText}>Reset Default</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionDesc}>
                Toggle widgets on/off and use up/down arrows to reorder dashboard cards.
              </Text>

              {widgetOrder.map((widgetId, index) => {
                const info = WIDGET_LABELS[widgetId] || {
                  title: widgetId,
                  description: 'Custom widget',
                  icon: '📊',
                };
                const isEnabled = enabledWidgets.includes(widgetId);

                return (
                  <View
                    key={widgetId}
                    style={[styles.widgetItem, !isEnabled && styles.widgetItemDisabled]}
                  >
                    <View style={styles.widgetIconBox}>
                      <Text style={styles.widgetIcon}>{info.icon}</Text>
                    </View>

                    <View style={styles.widgetInfo}>
                      <Text style={[styles.widgetTitle, !isEnabled && styles.widgetTitleDisabled]}>
                        {info.title}
                      </Text>
                      <Text style={styles.widgetDescription}>{info.description}</Text>
                    </View>

                    <View style={styles.widgetActions}>
                      <View style={styles.reorderButtons}>
                        <TouchableOpacity
                          onPress={() => handleMoveUp(index)}
                          disabled={index === 0}
                          style={[styles.arrowBtn, index === 0 && styles.arrowBtnDisabled]}
                        >
                          <Text style={styles.arrowText}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleMoveDown(index)}
                          disabled={index === widgetOrder.length - 1}
                          style={[
                            styles.arrowBtn,
                            index === widgetOrder.length - 1 && styles.arrowBtnDisabled,
                          ]}
                        >
                          <Text style={styles.arrowText}>▼</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity
                        style={[styles.toggleBtn, isEnabled && styles.toggleBtnActive]}
                        onPress={() => toggleWidget(widgetId)}
                      >
                        <Text
                          style={[styles.toggleBtnText, isEnabled && styles.toggleBtnTextActive]}
                        >
                          {isEnabled ? 'ON' : 'OFF'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneButton} onPress={onClose}>
              <Text style={styles.doneButtonText}>Save & Apply Changes</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 14, 23, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    marginTop: spacing.xxl * 1.5,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#1E293B',
  },
  title: {
    ...typography.h2,
    color: '#F8FAFC',
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: '#E2E8F0',
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  sectionDesc: {
    ...typography.caption,
    color: '#64748B',
    marginBottom: spacing.md,
  },
  modelSelectorContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  modelOption: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modelOptionActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3B82F6',
  },
  modelOptionTitle: {
    ...typography.bodyBold,
    color: '#94A3B8',
    marginBottom: 4,
  },
  modelOptionTitleActive: {
    color: '#60A5FA',
  },
  modelOptionDesc: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 11,
  },
  modelOptionDescActive: {
    color: '#BFDBFE',
  },
  resetButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    backgroundColor: '#334155',
  },
  resetButtonText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  widgetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: spacing.sm,
  },
  widgetItemDisabled: {
    opacity: 0.5,
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
  },
  widgetIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  widgetIcon: {
    fontSize: 20,
  },
  widgetInfo: {
    flex: 1,
  },
  widgetTitle: {
    ...typography.bodyBold,
    color: '#F8FAFC',
  },
  widgetTitleDisabled: {
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  widgetDescription: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 11,
  },
  widgetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reorderButtons: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: borderRadius.sm,
    padding: 2,
  },
  arrowBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  arrowBtnDisabled: {
    opacity: 0.2,
  },
  arrowText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  toggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: '#334155',
    minWidth: 50,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#3B82F6',
  },
  toggleBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleBtnTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: '#1E293B',
  },
  doneButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  doneButtonText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
});
