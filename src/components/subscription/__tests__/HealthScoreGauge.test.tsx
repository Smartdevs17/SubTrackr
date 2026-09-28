import React from 'react';
import { render } from '@testing-library/react-native';
import {
  HealthScoreGauge,
  getHealthStatusInfo,
  getTrendSymbol,
} from '../HealthScoreGauge';

describe('HealthScoreGauge Component', () => {
  describe('getHealthStatusInfo', () => {
    test('categorizes critical scores (< 50)', () => {
      const info = getHealthStatusInfo(35);
      expect(info.status).toBe('critical');
      expect(info.color).toBe('#EF4444');
      expect(info.label).toBe('Critical');
    });

    test('categorizes warning scores (50 - 74)', () => {
      const info = getHealthStatusInfo(65);
      expect(info.status).toBe('warning');
      expect(info.color).toBe('#F59E0B');
      expect(info.label).toBe('Warning');
    });

    test('categorizes healthy scores (>= 75)', () => {
      const info = getHealthStatusInfo(90);
      expect(info.status).toBe('healthy');
      expect(info.color).toBe('#10B981');
      expect(info.label).toBe('Healthy');
    });

    test('clamps scores below 0 and above 100', () => {
      expect(getHealthStatusInfo(-10).status).toBe('critical');
      expect(getHealthStatusInfo(150).status).toBe('healthy');
    });
  });

  describe('getTrendSymbol', () => {
    test('returns correct symbols for up, down, stable', () => {
      expect(getTrendSymbol('up')).toBe('↑');
      expect(getTrendSymbol('down')).toBe('↓');
      expect(getTrendSymbol('stable')).toBe('→');
      expect(getTrendSymbol(undefined)).toBe('');
    });
  });

  describe('Component Rendering', () => {
    test('renders score and label correctly', () => {
      const { getByTestId, getByText } = render(
        <HealthScoreGauge score={85} trend="up" label="Active Health" />
      );

      expect(getByTestId('health-score-gauge')).toBeTruthy();
      expect(getByText('85')).toBeTruthy();
      expect(getByText('↑')).toBeTruthy();
      expect(getByText('Active Health')).toBeTruthy();
    });

    test('renders with default label when custom label is omitted', () => {
      const { getByText } = render(<HealthScoreGauge score={40} />);
      expect(getByText('40')).toBeTruthy();
      expect(getByText('Critical')).toBeTruthy();
    });
  });
});
