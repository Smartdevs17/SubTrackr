# Subscription Analytics with Revenue Forecasting

## Overview

Issue #774 implements comprehensive revenue forecasting and trend analysis for SubTrackr, enabling data-driven decision making with accurate predictions and visualization data.

## Architecture

```
backend/services/analytics/
├── revenueForecastService.ts   # Forecasting engine
├── predictionService.ts        # Existing ML-based predictions
└── index.ts                    # Exports
```

## Features

### 1. Revenue Forecasting Models

Multiple forecasting models are available:

```typescript
import { generateRevenueForecast } from '../services/analytics';

// Linear regression forecast
const linearForecast = generateRevenueForecast(historicalData, {
  horizon: 6,
  granularity: 'month',
  model: 'linear',
  confidence: 0.95,
});

// Exponential smoothing forecast
const expForecast = generateRevenueForecast(historicalData, {
  horizon: 12,
  model: 'exponential',
});

// Moving average forecast
const maForecast = generateRevenueForecast(historicalData, {
  horizon: 6,
  model: 'moving_average',
});
```

### 2. Trend Analysis

Analyze revenue trends with multiple metrics:

```typescript
import { analyzeTrend } from '../services/analytics';

const trend = analyzeTrend(historicalData);
// {
//   direction: 'up',
//   strength: 0.85,
//   growthRate: 12.5,
//   hasSeasonality: true,
//   movingAverage: [...],
//   trendLine: [...],
// }
```

### 3. Forecast Accuracy Tracking

Measure forecast accuracy against actuals:

```typescript
import { calculateAccuracy } from '../services/analytics';

const accuracy = calculateAccuracy(forecasts, actuals);
// {
//   mae: 1250.50,      // Mean Absolute Error
//   mape: 8.3,         // Mean Absolute Percentage Error
//   rmse: 1580.25,     // Root Mean Squared Error
//   rSquared: 0.92,    // R-squared (goodness of fit)
//   comparisons: [...]
// }
```

### 4. Forecast Visualization

Generate chart-ready data:

```typescript
import { generateVisualizationData } from '../services/analytics';

const vizData = generateVisualizationData(historical, forecasts, 0.95);
// {
//   series: [
//     { period: '2026-01', historical: 50000, forecast: null, ... },
//     { period: '2026-02', historical: 55000, forecast: null, ... },
//     { period: '2026-07', historical: null, forecast: 62000, ... },
//   ],
//   summary: {
//     currentMrr: 55000,
//     projectedMrr: 62000,
//     growthRate: 12.7,
//     confidenceLevel: 0.95,
//   }
// }
```

### 5. Forecast Alerts

Automatic alerts based on forecast analysis:

```typescript
import { generateForecastAlerts } from '../services/analytics';

const alerts = generateForecastAlerts(forecast, {
  declinePercent: -10,
  growthPercent: 20,
  deviationPercent: 15,
});
// [
//   {
//     type: 'revenue_decline',
//     severity: 'critical',
//     title: 'Revenue Decline Detected',
//     message: 'Revenue is declining at -12.5% per period',
//   }
// ]
```

## Forecasting Models

### Linear Regression

Best for: Steady growth/decline patterns

```
Revenue = intercept + slope × time
```

### Exponential Smoothing

Best for: Recent data is more relevant

```
Smoothed = α × actual + (1 - α) × previous_smoothed
```

### Moving Average

Best for: Smoothing out noise

```
Forecast = average(last N periods)
```

## Output Format

### Forecast Point

```typescript
{
  period: '2026-07-01T00:00:00.000Z',
  predictedRevenue: 62500,
  lowerBound: 58000,
  upperBound: 67000,
  confidence: 0.95,
  model: 'linear'
}
```

### Trend Analysis

```typescript
{
  direction: 'up',          // 'up' | 'down' | 'stable'
  strength: 0.85,           // 0-1 (R² value)
  growthRate: 12.5,         // Percentage
  hasSeasonality: true,
  movingAverage: [...],
  trendLine: [...]
}
```

### Accuracy Metrics

| Metric | Description | Good Value |
|--------|-------------|------------|
| MAE | Mean Absolute Error | < 5% of mean |
| MAPE | Mean Absolute Percentage Error | < 10% |
| RMSE | Root Mean Squared Error | < 10% of mean |
| R² | Goodness of fit | > 0.8 |

## Usage Examples

### Monthly MRR Forecast

```typescript
const historicalData: RevenueDataPoint[] = [
  { period: '2026-01', revenue: 50000, subscriberCount: 1000, arpu: 50, ... },
  { period: '2026-02', revenue: 55000, subscriberCount: 1100, arpu: 50, ... },
  // ...
];

const forecast = generateRevenueForecast(historicalData, {
  horizon: 6,
  granularity: 'month',
  model: 'linear',
  confidence: 0.95,
});

console.log('Next 6 months forecast:');
forecast.forecasts.forEach(f => {
  console.log(`${f.period}: $${f.predictedRevenue.toFixed(2)} (±${(f.upperBound - f.lowerBound).toFixed(2)})`);
});
```

### Compare Models

```typescript
const models: ForecastModel[] = ['linear', 'exponential', 'moving_average'];

for (const model of models) {
  const forecast = generateRevenueForecast(data, { model, horizon: 6 });
  if (data.length > 6) {
    const accuracy = calculateAccuracy(forecast.forecasts, data.slice(-6));
    console.log(`${model}: MAPE=${accuracy.mape.toFixed(2)}%, R²=${accuracy.rSquared.toFixed(3)}`);
  }
}
```

## Alert Thresholds

| Alert Type | Default Threshold | Severity |
|------------|-------------------|----------|
| Revenue Decline | -10% growth rate | Critical |
| Growth Spike | +20% growth rate | Info |
| High Deviation | >15% CI width | Warning |
| Seasonal Pattern | Detected | Info |

## API Integration

### REST Endpoint

```typescript
// GET /analytics/forecast?horizon=6&model=linear&confidence=0.95
app.get('/analytics/forecast', (req, res) => {
  const forecast = generateRevenueForecast(historicalData, {
    horizon: parseInt(req.query.horizon) || 6,
    model: req.query.model || 'linear',
    confidence: parseFloat(req.query.confidence) || 0.95,
  });

  const vizData = generateVisualizationData(historicalData, forecast.forecasts);

  res.json({
    forecast,
    visualization: vizData,
    alerts: generateForecastAlerts(forecast),
  });
});
```

## Performance Considerations

1. **Caching**: Forecasts should be cached for 1-5 minutes
2. **Data Limits**: Keep last 24 months for monthly forecasts
3. **Model Selection**: Auto-select best model based on accuracy
4. **Background Jobs**: Generate forecasts in background, store results
