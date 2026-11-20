# Memoized subscription rows (Issue #2088)

A self-contained row module for subscription lists. The goal is to stop
re-rendering every visible cell when a filter, sort order, or optimistic update
produces a fresh array of item objects.

## Usage

```tsx
import React, { useCallback } from 'react';
import { FlatList } from 'react-native';
import {
  createKeyExtractor,
  SubscriptionRow,
  useStableRowKeySelector,
} from './screens/subscriptions/row';

const keySelector = useStableRowKeySelector();
const keyExtractor = useCallback(createKeyExtractor(keySelector), [keySelector]);
const renderItem = useCallback(
  ({ item, index }) => (
    <SubscriptionRow subscription={item} index={index} onPress={handlePress} />
  ),
  [handlePress]
);

<FlatList data={subscriptions} renderItem={renderItem} keyExtractor={keyExtractor} />;
```

## What makes it fast

- **Stable keys.** `subscriptionRowKey` keys by `subscription.id`, never by
  array index. Reordering therefore does not remount confirmed rows. Optimistic
  inserts (no id yet) get a deterministic key composed of name, dates, and
  index, and are remounted once the server assigns an id.
- **Field-level `React.memo`.** `areRowPropsEqual` compares only the fields the
  row renders, so a new object with identical content does not re-render. The
  index is compared as well, so reordering still updates row position props.
- **Memoized selector.** `useStableRowKeySelector` keeps the `keyExtractor`
  identity stable; parents should also wrap `onPress` in `useCallback`.

## Observability

Pass `onRender` to receive `{ key, renderedAt }` whenever a row actually
renders. Use it to log excessive re-render counts in performance builds.
