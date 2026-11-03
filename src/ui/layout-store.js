// Persistence for per-window layout state (pane and column sizes, hidden columns).
// Default backend: localStorage of the extension origin, wrapped so a blocked or full storage
// never breaks the UI. M2 can swap in storage.local with setLayoutStore().

/**
 * @typedef {object} LayoutStore
 * @property {(key: string) => unknown} get returns undefined when missing or unreadable
 * @property {(key: string, value: unknown) => void} set
 * @property {() => void} clear removes every key (Delete All Data)
 */

const PREFIX = 'tt.layout.';

/** @type {LayoutStore} */
export const localStorageStore = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage blocked or full: the layout just isn't remembered.
    }
  },
  clear() {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
      for (const key of keys) if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    } catch {
      // Storage blocked: nothing was stored.
    }
  },
};

let store = localStorageStore;

/** @param {LayoutStore} next */
export function setLayoutStore(next) {
  store = next;
}

/** @param {string} key */
export function getLayout(key) {
  return store.get(key);
}

/** @param {string} key @param {unknown} value */
export function setLayout(key, value) {
  store.set(key, value);
}

/** Forgets every stored layout value (sizes, selection, filter text). */
export function clearLayout() {
  store.clear();
}
