/** Static guards for the FlashList migration (Issue #2075). */

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

describe('virtualised subscriptions list', () => {
  const list = read('SubscriptionFlashList.tsx');
  const screen = read('SubscriptionListScreen.tsx');

  it('renders with FlashList and never with FlatList', () => {
    expect(list).toMatch(/import\s*\{\s*FlashList\s*\}\s*from\s*'@shopify\/flash-list'/);
    expect(list).toMatch(/<FlashList\b/);
    expect(list).not.toMatch(/\bFlatList\b/);
    expect(screen).not.toMatch(/\bFlatList\b/);
  });

  it('pins the virtualisation and stable-key props', () => {
    for (const prop of [
      'data={rows}',
      'keyExtractor={keyExtractor}',
      'estimatedItemSize={tuning.estimatedItemSize}',
      'drawDistance={tuning.drawDistance}',
      'windowSize={tuning.windowSize}',
      'removeClippedSubviews={tuning.removeClippedSubviews}',
      'onViewableItemsChanged={handleViewableItemsChanged}',
    ]) {
      expect(list).toContain(prop);
    }
  });

  it('fetches screen data through the query layer, not raw fetch', () => {
    expect(screen).toMatch(/useQuery/);
    expect(screen).toMatch(/subscriptionKeys\.list/);
    expect(screen).not.toMatch(/\bfetch\(/);
  });

  it('documents the list and its observability hooks', () => {
    const readme = read('README.md');
    expect(readme).toContain('#2075');
    expect(readme).toContain('FlashList');
    expect(readme).toContain('Observability');
  });
});
