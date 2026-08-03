export const PROJECT_STORE = "projects";
export const GENERATED_MAP_CACHE_STORE = "generated-map-cache";
export const PREFERENCE_STORE = "preferences";

const DB_NAME = "forge-material-studio";
const DB_VERSION = 3;

export function openMaterialDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        const store = database.createObjectStore(PROJECT_STORE, {
          keyPath: "id",
        });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains(GENERATED_MAP_CACHE_STORE)) {
        const store = database.createObjectStore(GENERATED_MAP_CACHE_STORE, {
          keyPath: "key",
        });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(PREFERENCE_STORE)) {
        database.createObjectStore(PREFERENCE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Local storage is unavailable."));
  });
}
