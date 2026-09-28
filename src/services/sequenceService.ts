import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  SEQUENCE_PREFIX: '@SubTrackr:sequence:',
};

// In-memory lock to prevent race conditions during rapid calls
let sequenceLock = Promise.resolve();

export async function getNextSequence(prefix: string): Promise<number> {
  return new Promise((resolve, reject) => {
    sequenceLock = sequenceLock
      .then(async () => {
        try {
          const key = `${STORAGE_KEYS.SEQUENCE_PREFIX}${prefix}`;
          const current = await AsyncStorage.getItem(key);
          const nextSeq = current ? parseInt(current, 10) + 1 : 1;
          
          await AsyncStorage.setItem(key, nextSeq.toString());
          resolve(nextSeq);
        } catch (error) {
          reject(error);
        }
      })
      .catch((err) => {
        // If a previous promise rejected, we just log and resolve the current one independently
        console.error('Previous sequence operation failed', err);
        return (async () => {
          try {
            const key = `${STORAGE_KEYS.SEQUENCE_PREFIX}${prefix}`;
            const current = await AsyncStorage.getItem(key);
            const nextSeq = current ? parseInt(current, 10) + 1 : 1;
            
            await AsyncStorage.setItem(key, nextSeq.toString());
            resolve(nextSeq);
          } catch (error) {
            reject(error);
          }
        })();
      });
  });
}

export async function getCurrentSequence(prefix: string): Promise<number> {
  try {
    const key = `${STORAGE_KEYS.SEQUENCE_PREFIX}${prefix}`;
    const current = await AsyncStorage.getItem(key);
    return current ? parseInt(current, 10) : 0;
  } catch (error) {
    console.error(`Failed to get current sequence for ${prefix}:`, error);
    return 0;
  }
}

export async function resetSequence(prefix: string): Promise<void> {
  try {
    const key = `${STORAGE_KEYS.SEQUENCE_PREFIX}${prefix}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error(`Failed to reset sequence for ${prefix}:`, error);
    throw error;
  }
}

export function generateLegalInvoiceNumber(
  sequence: number,
  prefix: string = 'INV',
  includeYear: boolean = true,
  includeMonth: boolean = true,
  date: Date = new Date()
): string {
  const parts = [prefix];
  
  if (includeYear) {
    const year = date.getFullYear();
    if (includeMonth) {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      parts.push(`${year}${month}`);
    } else {
      parts.push(`${year}`);
    }
  }
  
  parts.push(String(sequence).padStart(4, '0'));
  return parts.join('-');
}
