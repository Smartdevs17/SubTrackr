import * as fs from 'fs';
import * as path from 'path';

const SCREENS_DIR = path.join(__dirname, '..', '..', 'screens');

const MIGRATED_SCREENS = [
  'ImportScreen.tsx',
  'ErrorDashboardScreen.tsx',
  'LoyaltyDashboardScreen.tsx',
  'SegmentManagementScreen.tsx',
];

const SCREENS_THAT_SHOULD_NOT_IMPORT_FLATLIST = [
  'CampaignManagementScreen.tsx',
  'AffiliateDashboardScreen.tsx',
];

function readScreenSource(fileName: string): string {
  return fs.readFileSync(path.join(SCREENS_DIR, fileName), 'utf8');
}

describe('FlashList migration (#408)', () => {
  describe.each(MIGRATED_SCREENS)('%s', (fileName) => {
    const source = readScreenSource(fileName);

    it('does not import FlatList from react-native', () => {
      const flatListImportRegex =
        /import\s*\{[^}]*\bFlatList\b[^}]*\}\s*from\s*['"]react-native['"]/;
      expect(flatListImportRegex.test(source)).toBe(false);
    });

    it('imports FlashList from @shopify/flash-list', () => {
      expect(source).toMatch(
        /import\s*\{[^}]*\bFlashList\b[^}]*\}\s*from\s*['"]@shopify\/flash-list['"]/
      );
    });

    it('uses <FlashList> JSX element', () => {
      expect(source).toMatch(/<FlashList[\s>]/);
    });
  });

  describe.each(SCREENS_THAT_SHOULD_NOT_IMPORT_FLATLIST)('%s', (fileName) => {
    const source = readScreenSource(fileName);

    it('does not import FlatList (unused import removed)', () => {
      const flatListImportRegex =
        /import\s*\{[^}]*\bFlatList\b[^}]*\}\s*from\s*['"]react-native['"]/;
      expect(flatListImportRegex.test(source)).toBe(false);
    });
  });
});
