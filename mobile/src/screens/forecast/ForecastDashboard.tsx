import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  PredictionService,
  type ForecastPoint,
  type RevenueObservation,
} from '../../../../backend/services/analytics/prediction';

export interface ForecastDashboardProps {
  observations: RevenueObservation[];
  horizon?: number;
  currency?: string;
}

/** Small ML-backed forecast surface; the caller owns the surrounding navigation. */
export const ForecastDashboard: React.FC<ForecastDashboardProps> = ({
  observations,
  horizon = 3,
  currency = 'USD',
}) => {
  const [points, setPoints] = useState<ForecastPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    PredictionService.forecastRevenue(observations, horizon)
      .then((result) => active && setPoints(result))
      .catch(
        (reason) => active && setError(reason instanceof Error ? reason.message : String(reason))
      );
    return () => {
      active = false;
    };
  }, [horizon, observations]);

  if (error) return <Text accessibilityRole="alert">Unable to load forecast: {error}</Text>;
  if (points.length === 0) return <ActivityIndicator accessibilityLabel="Loading forecast" />;

  return (
    <View accessibilityLabel="Billing forecast dashboard">
      {points.map((point) => (
        <View key={point.period} style={styles.row}>
          <Text>{point.period}</Text>
          <Text>
            {currency} {point.expectedRevenue.toFixed(2)}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
});
