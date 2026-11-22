import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DragDropPlanBuilder } from '../DragDropPlanBuilder';

describe('DragDropPlanBuilder (Issue #1278)', () => {
  it('renders initial plan tiers correctly', () => {
    const { getByTestId, getByText } = render(<DragDropPlanBuilder />);
    expect(getByTestId('tier-card-tier-basic')).toBeTruthy();
    expect(getByTestId('tier-card-tier-pro')).toBeTruthy();
    expect(getByText('Basic')).toBeTruthy();
    expect(getByText('Pro')).toBeTruthy();
  });

  it('reorders tiers when up/down controls are pressed', () => {
    const onChangeMock = jest.fn();
    const { getByTestId } = render(<DragDropPlanBuilder onChange={onChangeMock} />);

    const moveDownBtn = getByTestId('move-down-tier-tier-basic');
    fireEvent.press(moveDownBtn);

    expect(onChangeMock).toHaveBeenCalled();
    const updatedTiers = onChangeMock.mock.calls[0][0];
    expect(updatedTiers[0].id).toBe('tier-pro');
    expect(updatedTiers[1].id).toBe('tier-basic');
  });

  it('adds a feature to a tier', () => {
    const onChangeMock = jest.fn();
    const { getByTestId, getByText } = render(<DragDropPlanBuilder onChange={onChangeMock} />);

    const input = getByTestId('add-feature-input-tier-basic');
    const addBtn = getByTestId('add-feature-btn-tier-basic');

    fireEvent.changeText(input, 'Automated Backups');
    fireEvent.press(addBtn);

    expect(getByText('• Automated Backups')).toBeTruthy();
    expect(onChangeMock).toHaveBeenCalled();
  });

  it('deletes a feature from a tier', () => {
    const onChangeMock = jest.fn();
    const { getByTestId } = render(<DragDropPlanBuilder onChange={onChangeMock} />);

    const deleteBtn = getByTestId('delete-feature-tier-basic-0');
    fireEvent.press(deleteBtn);

    expect(onChangeMock).toHaveBeenCalled();
  });
});
