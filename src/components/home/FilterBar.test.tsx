import React from 'react';
import { render, screen, fireEvent } from '../../test-utils';
import { FilterBar } from './FilterBar';

describe('FilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const defaultProps = {
    searchQuery: '',
    setSearchQuery: jest.fn(),
    onFilterPress: jest.fn(),
    hasActiveFilters: false,
    activeFilterCount: 0,
  };

  describe('search interactions', () => {
    it('calls setSearchQuery with the typed text', () => {
      const setSearchQuery = jest.fn();
      render(<FilterBar {...defaultProps} setSearchQuery={setSearchQuery} />);

      fireEvent.changeText(screen.getByPlaceholderText('Search subscriptions...'), 'netflix');

      expect(setSearchQuery).toHaveBeenCalledWith('netflix');
    });

    it('clears the search query when the clear button is pressed', () => {
      const setSearchQuery = jest.fn();
      render(<FilterBar {...defaultProps} searchQuery="netflix" setSearchQuery={setSearchQuery} />);

      fireEvent.press(screen.getByLabelText('Clear search'));

      expect(setSearchQuery).toHaveBeenCalledWith('');
    });

    it('does not render a clear button when the query is empty', () => {
      render(<FilterBar {...defaultProps} searchQuery="" />);

      expect(screen.queryByLabelText('Clear search')).toBeNull();
    });
  });

  describe('filter interactions', () => {
    it('calls onFilterPress when the filter button is pressed', () => {
      const onFilterPress = jest.fn();
      render(<FilterBar {...defaultProps} onFilterPress={onFilterPress} />);

      fireEvent.press(screen.getByLabelText('Filters'));

      expect(onFilterPress).toHaveBeenCalledTimes(1);
    });

    it('shows the active filter count in the accessibility label and badge', () => {
      render(<FilterBar {...defaultProps} hasActiveFilters activeFilterCount={3} />);

      // Badge text is visible to the user...
      expect(screen.getByText('3')).toBeTruthy();
      // ...and the active count is announced to assistive tech.
      expect(screen.getByLabelText('Filters, 3 active')).toBeTruthy();
    });
  });
});
