/**
 * useSearchSuggestions — autocomplete / typeahead hook.
 *
 * Debounces the partial query and returns a list of suggestion strings
 * from the indexed corpus, suitable for rendering a dropdown or chip list.
 *
 * Usage:
 *  const { suggestions, isLoading } = useSearchSuggestions(partialQuery);
 */
import { useState, useEffect } from 'react';
import { searchService } from '../../backend/services/subscription/search';
import { useDebounce } from './useDebounce';

const MIN_CHARS_FOR_SUGGESTIONS = 2;

export interface UseSearchSuggestionsReturn {
  /** Autocomplete strings for the current partial query */
  suggestions: string[];
  /** True while the suggestions are being computed */
  isLoading: boolean;
}

export function useSearchSuggestions(
  partial: string,
  options: {
    limit?: number;
    includeCategories?: boolean;
    /** Override debounce delay in ms (default: network-aware via useDebounce) */
    debounceMs?: number;
  } = {}
): UseSearchSuggestionsReturn {
  const { limit = 8, includeCategories = true } = options;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedPartial = useDebounce(partial, options.debounceMs);

  useEffect(() => {
    if (!debouncedPartial || debouncedPartial.trim().length < MIN_CHARS_FOR_SUGGESTIONS) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const results = searchService.getSuggestions({
        partial: debouncedPartial,
        limit,
        includeCategories,
      });
      setSuggestions(results);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedPartial, limit, includeCategories]);

  return { suggestions, isLoading };
}
