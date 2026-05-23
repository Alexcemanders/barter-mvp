import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage may fail on some setups with:
// "Native module is null, cannot access legacy storage"
// Provide a safe in-memory fallback so the UI still works in development.
let inMemoryStore: Record<string, string> = {};

const KEYS = {
  vendorNumber: 'barter:user:vendorNumber',
  profileByVendor: (vendorNumber: string) => `barter:user:profile:${vendorNumber}`,
  reputation: 'barter:reputation:v1',
  trades: 'barter:trades:v1',
};

function isAsyncStorageNativeFailure(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  return msg.includes('Native module is null') || msg.includes('legacy storage');
}

export async function storageGetString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    if (!isAsyncStorageNativeFailure(e)) throw e;
    return inMemoryStore[key] ?? null;
  }
}

export async function storageSetString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    if (!isAsyncStorageNativeFailure(e)) throw e;
    inMemoryStore[key] = value;
  }
}


export async function storageGetJSON<T>(key: string): Promise<T | null> {
  const raw = await storageGetString(key);
  if (!raw) return null;
  try {
    // If older versions stored booleans as strings ("true"/"false"),
    // we parse as-is here; callers can normalize fields if needed.
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}


export async function storageSetJSON(key: string, value: unknown): Promise<void> {
  await storageSetString(key, JSON.stringify(value));
}




export { KEYS };

