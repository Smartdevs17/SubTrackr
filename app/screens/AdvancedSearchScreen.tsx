import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet } from 'react-native';
import { Subscription } from '../types/subscription';
import { search_subscriptions, SavedSearch, SearchQuery } from '../services/searchService';
import { useSubscriptionStore } from '../../src/store';
import { useSearchStore } from '../stores/searchStore';

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  input: { height: 40, borderColor: '#ccc', borderWidth: 1, paddingHorizontal: 8, borderRadius: 4 },
  item: { paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12, color: '#666' },
  header: { fontSize: 18, fontWeight: '700', marginVertical: 8 },
});

export const AdvancedSearchScreen: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  const { subscriptions } = useSubscriptionStore.getState();
  const [results, setResults] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = () => {
    setLoading(true);
    // Lightweight synchronous search; in a real app this could be async if hitting API
    const result = search_subscriptions({ query, filters: {} });
    setResults(result.subscriptions);
    setLoading(false);
  };

  // Initial populate with all subscriptions for UX in absence of a query
  const initialAll = useMemo(() => subscriptions, [subscriptions]);

  React.useEffect(() => {
    if (initialAll?.length) {
      setResults(initialAll);
    }
  }, [initialAll]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Advanced Subscription Search</Text>
      <TextInput
        style={styles.input}
        placeholder="Search subscriptions..."
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={runSearch}
        returnKeyType="search"
      />
      <Button title="Search" onPress={runSearch} disabled={loading} />
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.subtitle}>{item.category} • {item.currency} {item.price.toFixed(2)} / {item.billingCycle}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={{ paddingTop: 8 }}>No results</Text>}
      />
    </View>
  );
};

export default AdvancedSearchScreen;
