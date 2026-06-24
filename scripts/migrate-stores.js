const fs = require('fs');

const stores = [
  'src/store/webhookStore.ts',
  'src/store/usageStore.ts',
  'src/store/transactionQueueStore.ts',
  'src/store/slaStore.ts',
  'src/store/segmentStore.ts',
  'src/store/sandboxStore.ts',
  'src/store/merchantStore.ts',
  'src/store/loyaltyStore.ts',
  'src/store/gamificationStore.ts',
  'src/store/fraudStore.ts',
  'src/store/communityStore.ts',
  'src/store/campaignStore.ts',
  'src/store/apiStore.ts',
  'src/store/affiliateStore.ts',
  'src/store/accountingStore.ts',
  'src/store/developerPortalStore.ts',
];

const asyncImport = `import AsyncStorage from '@react-native-async-storage/async-storage';`;
const adapterImport = `import { asyncStorageAdapter } from '../utils/storage';`;

const asyncStorage = `storage: createJSONStorage(() => AsyncStorage)`;
const adapterStorage = `storage: createJSONStorage(() => asyncStorageAdapter)`;

// Also handle the reversed import order some stores use
const asyncImportAlt = `import AsyncStorage from "@react-native-async-storage/async-storage";`;

let totalReplaced = 0;

stores.forEach((f) => {
  if (!fs.existsSync(f)) {
    console.log('SKIP (not found):', f);
    return;
  }
  let c = fs.readFileSync(f, 'utf8');
  const before = c;
  c = c.split(asyncImport).join(adapterImport);
  c = c.split(asyncImportAlt).join(adapterImport);
  c = c.split(asyncStorage).join(adapterStorage);
  if (c !== before) {
    fs.writeFileSync(f, c);
    totalReplaced++;
    console.log('Migrated:', f);
  } else {
    console.log('No changes:', f);
  }
});

console.log(`\nDone. Migrated ${totalReplaced} files.`);
