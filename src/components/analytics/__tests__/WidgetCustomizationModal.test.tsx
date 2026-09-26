import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { WidgetCustomizationModal } from '../WidgetCustomizationModal';
import { useWidgetStore } from '../../../store/widgetStore';

describe('WidgetCustomizationModal (Issue #1274)', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    act(() => {
      useWidgetStore.getState().resetWidgetConfig();
    });
  });

  it('renders modal content when visible', () => {
    const { getByText } = render(
      <WidgetCustomizationModal visible={true} onClose={mockOnClose} />
    );

    expect(getByText('Dashboard Customizer')).toBeTruthy();
    expect(getByText('MRR & ARR Overview')).toBeTruthy();
    expect(getByText('Historical Revenue Trend')).toBeTruthy();
  });

  it('toggles widget visibility on press', () => {
    const { getAllByText } = render(
      <WidgetCustomizationModal visible={true} onClose={mockOnClose} />
    );

    const initialEnabled = useWidgetStore.getState().enabledWidgets;
    expect(initialEnabled).toContain('overview');

    const toggleBtns = getAllByText('ON');
    fireEvent.press(toggleBtns[0]);

    const updatedEnabled = useWidgetStore.getState().enabledWidgets;
    expect(updatedEnabled).not.toContain('overview');
  });

  it('switches forecast model selection', () => {
    const { getByText } = render(
      <WidgetCustomizationModal visible={true} onClose={mockOnClose} />
    );

    const linearOption = getByText('Linear Regression');
    fireEvent.press(linearOption);

    expect(useWidgetStore.getState().forecastModel).toBe('linear');
  });

  it('calls onClose when close or done button is pressed', () => {
    const { getByTestId } = render(
      <WidgetCustomizationModal visible={true} onClose={mockOnClose} />
    );

    const doneButton = getByTestId('save-apply-button');
    fireEvent.press(doneButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});

