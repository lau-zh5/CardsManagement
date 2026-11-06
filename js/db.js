const DB_NAME = 'cardsapp';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('secrets')) {
        const s = db.createObjectStore('secrets', { keyPath: 'id' });
        s.createIndex('cardId', 'cardId');
      }
      if (!db.objectStoreNames.contains('vault')) {
        db.createObjectStore('vault', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function simple(store, mode, method, ...args) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = tx.objectStore(store)[method](...args);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  }));
}

export const Cards = {
  all: () => simple('cards', 'readonly', 'getAll'),
  get: (id) => simple('cards', 'readonly', 'get', id),
  put: (card) => simple('cards', 'readwrite', 'put', card),
  remove: (id) => simple('cards', 'readwrite', 'delete', id)
};

export const Secrets = {
  forCard(cardId) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('secrets', 'readonly');
      const req = tx.objectStore('secrets').index('cardId').getAll(IDBKeyRange.only(cardId));
      req.onsuccess = () => resolve(req.result || []);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('事务已中止'));
    }));
  },
  all: () => simple('secrets', 'readonly', 'getAll'),
  put: (record) => simple('secrets', 'readwrite', 'put', record)
};

export const Vault = {
  get: () => simple('vault', 'readonly', 'get', 'config'),
  put: (cfg) => simple('vault', 'readwrite', 'put', { ...cfg, key: 'config' })
};

export async function saveCardBundle(card, secretRecords) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'secrets'], 'readwrite');
    const store = tx.objectStore('secrets');
    const idx = store.index('cardId');
    const del = idx.getAllKeys(IDBKeyRange.only(card.id));
    del.onsuccess = () => {
      (del.result || []).forEach((key) => store.delete(key));
      secretRecords.forEach((rec) => store.put(rec));
      tx.objectStore('cards').put(card);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  });
}

export async function removeCardBundle(cardId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'secrets'], 'readwrite');
    const store = tx.objectStore('secrets');
    const del = store.index('cardId').getAllKeys(IDBKeyRange.only(cardId));
    del.onsuccess = () => {
      (del.result || []).forEach((key) => store.delete(key));
      tx.objectStore('cards').delete(cardId);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  });
}

export async function exportRaw() {
  const [cards, secrets] = await Promise.all([Cards.all(), Secrets.all()]);
  return { cards, secrets };
}

export async function replaceAll(cards, secretRecords) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'secrets'], 'readwrite');
    tx.objectStore('cards').clear();
    tx.objectStore('secrets').clear();
    cards.forEach((card) => tx.objectStore('cards').put(card));
    secretRecords.forEach((rec) => tx.objectStore('secrets').put(rec));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  });
}

export async function wipe() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'secrets', 'vault'], 'readwrite');
    tx.objectStore('cards').clear();
    tx.objectStore('secrets').clear();
    tx.objectStore('vault').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务已中止'));
  });
}
