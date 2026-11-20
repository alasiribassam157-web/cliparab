/** Tiny IndexedDB key/value store for large things (source videos, thumbnails, exports, transcripts). */
const DB = "cliparab-local";
const STORE = "kv";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbp = null; err(r.error); };
  }));
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await db();
  return new Promise<T>((ok, err) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok((req ? req.result : undefined) as T);
    tx.onerror = () => err(tx.error);
    tx.onabort = () => err(tx.error ?? new Error("aborted"));
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key));
export const idbPut = (key: string, value: unknown) => run<void>("readwrite", (s) => { s.put(value, key); });
export const idbDel = (key: string) => run<void>("readwrite", (s) => { s.delete(key); });
export const idbDelPrefix = (prefix: string) => run<void>("readwrite", (s) => { s.delete(IDBKeyRange.bound(prefix, prefix + "￿")); });
export const idbClear = () => run<void>("readwrite", (s) => { s.clear(); });
