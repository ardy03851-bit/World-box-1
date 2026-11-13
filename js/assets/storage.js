// IndexedDB persistence: assets, source files, bundles, projects and photos.

const DB_NAME = 'worldbox-studio';
const DB_VERSION = 1;
const STORES = ['assets', 'files', 'bundles', 'projects', 'photos'];

let dbPromise = null;
const memory = {
  assets: new Map(), files: new Map(), bundles: new Map(), projects: new Map(), photos: new Map(),
};
let memoryOnly = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      memoryOnly = true;
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      memoryOnly = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'projects' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[db] open failed', req.error);
      memoryOnly = true;
      resolve(null);
    };
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then((db) => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      let result;
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      transaction.oncomplete = () => resolve(result?.request ? result.request.result : result);
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

export const storage = {
  async listAssets() {
    const db = await openDB();
    if (!db) return [...memory.assets.values()];
    return new Promise((resolve) => {
      const t = db.transaction('assets', 'readonly');
      const req = t.objectStore('assets').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  async putAsset(record) {
    memory.assets.set(record.id, record);
    await tx('assets', 'readwrite', (s) => s.put(record));
    return record;
  },

  async deleteAsset(id) {
    memory.assets.delete(id);
    await Promise.all([
      tx('assets', 'readwrite', (s) => s.delete(id)),
      tx('files', 'readwrite', (s) => s.delete(id)),
      tx('bundles', 'readwrite', (s) => s.delete(id)),
    ]);
  },

  async putFile(id, payload) {
    memory.files.set(id, payload);
    await tx('files', 'readwrite', (s) => s.put({ id, ...payload }));
  },

  async getFile(id) {
    const db = await openDB();
    if (!db) return memory.files.get(id) || null;
    return new Promise((resolve) => {
      const t = db.transaction('files', 'readonly');
      const req = t.objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || memory.files.get(id) || null);
      req.onerror = () => resolve(memory.files.get(id) || null);
    });
  },

  async putBundle(id, bundle) {
    memory.bundles.set(id, bundle);
    await tx('bundles', 'readwrite', (s) => s.put({ id, ...bundle }));
  },

  async getBundle(id) {
    const db = await openDB();
    if (!db) return memory.bundles.get(id) || null;
    return new Promise((resolve) => {
      const t = db.transaction('bundles', 'readonly');
      const req = t.objectStore('bundles').get(id);
      req.onsuccess = () => resolve(req.result || memory.bundles.get(id) || null);
      req.onerror = () => resolve(memory.bundles.get(id) || null);
    });
  },

  async saveProject(project) {
    const payload = { key: 'current', project, savedAt: Date.now() };
    memory.projects.set('current', payload);
    await tx('projects', 'readwrite', (s) => s.put(payload));
    try {
      localStorage.setItem('worldbox:lastSave', String(payload.savedAt));
    } catch { /* quota */ }
  },

  async loadProject() {
    const db = await openDB();
    if (!db) return memory.projects.get('current')?.project || null;
    return new Promise((resolve) => {
      const t = db.transaction('projects', 'readonly');
      const req = t.objectStore('projects').get('current');
      req.onsuccess = () => resolve(req.result?.project || null);
      req.onerror = () => resolve(null);
    });
  },

  async addPhoto(photo) {
    memory.photos.set(photo.id, photo);
    await tx('photos', 'readwrite', (s) => s.put(photo));
  },

  async listPhotos() {
    const db = await openDB();
    if (!db) return [...memory.photos.values()];
    return new Promise((resolve) => {
      const t = db.transaction('photos', 'readonly');
      const req = t.objectStore('photos').getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => resolve([]);
    });
  },

  async deletePhoto(id) {
    memory.photos.delete(id);
    await tx('photos', 'readwrite', (s) => s.delete(id));
  },

  async clearAll() {
    for (const s of STORES) {
      memory[s].clear();
      await tx(s, 'readwrite', (store) => store.clear());
    }
    try {
      localStorage.removeItem('worldbox:project');
      localStorage.removeItem('worldbox:lastSave');
    } catch { /* ignore */ }
  },

  async estimate() {
    try {
      const est = await navigator.storage?.estimate?.();
      return est || null;
    } catch {
      return null;
    }
  },

  get memoryOnly() {
    return memoryOnly;
  },
};
