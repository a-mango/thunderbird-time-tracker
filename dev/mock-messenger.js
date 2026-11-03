// In-memory `messenger`/`browser` for the dev harness and unit tests. Never shipped.
// Mirrors the signatures and documented semantics in .ref/webext-docs (release-mv3)
// for the APIs listed in src/types/messenger.d.ts. Keep both in sync.
//
// In the browser, scripts/serve.mjs injects this module first in <head>, together with
// a <script type="application/json" id="tt-dev-messages"> holding _locales/en/messages.json.
// The mock also plays the background page where pages need it: it registers the context menu
// items, and before the page script runs it seeds IndexedDB with fixtures (see `ready`).

import { registerMenus } from '../src/background/menus.js';
import { DB_NAME } from '../src/db/schema.js';
import { generateFixtures } from './fixtures.js';
import { databaseExists, deleteDatabase, seedDatabase, seedSettings } from './seed.js';

/**
 * @template {(...args: any[]) => any} T
 * @returns {WebExtEvent<T> & {dispatch: (...args: Parameters<T>) => ReturnType<T>[]}}
 */
export function createEvent() {
  /** @type {Set<T>} */
  const listeners = new Set();
  return {
    addListener: (cb) => void listeners.add(cb),
    removeListener: (cb) => void listeners.delete(cb),
    hasListener: (cb) => listeners.has(cb),
    dispatch: (...args) => [...listeners].map((cb) => cb(...args)),
  };
}

/** Predefined messages for an English, left-to-right UI. */
/** @type {Record<string, string>} */
const PREDEFINED_MESSAGES = {
  '@@ui_locale': 'en',
  '@@bidi_dir': 'ltr',
  '@@bidi_reversed_dir': 'rtl',
  '@@bidi_start_edge': 'left',
  '@@bidi_end_edge': 'right',
};

/**
 * Chrome-style message formatting: named placeholders, then $1..$9, then $$.
 * @param {Record<string, {message: string, placeholders?: Record<string, {content: string}>}>} messages
 * @param {string} name
 * @param {string | string[]} [substitutions]
 */
export function formatMessage(messages, name, substitutions) {
  const predefined = PREDEFINED_MESSAGES[name];
  if (predefined !== undefined) return predefined;
  const entry = messages[name];
  if (!entry) return '';
  const subs = substitutions === undefined ? [] : [substitutions].flat();
  const placeholders = Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value.content,
    ]),
  );
  return entry.message
    .replace(/\$([a-z0-9_@]+)\$/gi, (match, key) => placeholders[key.toLowerCase()] ?? match)
    .replace(/\$(\d)|\$\$/g, (match, index) => (index ? (subs[Number(index) - 1] ?? '') : '$'));
}

/** Thunderbird's built-in spaces, as returned by spaces.query({isBuiltIn: true}). */
const BUILT_IN_SPACES = ['mail', 'addressbook', 'calendar', 'tasks', 'chat', 'settings'];

/**
 * @typedef {object} MockOptions
 * @property {Record<string, any>} [messages] contents of _locales/en/messages.json
 * @property {string} [baseUrl] extension origin, ends with '/'
 * @property {Record<string, any>} [manifest]
 */

/**
 * @param {MockOptions} [options]
 */
export function createMessenger({
  messages = {},
  baseUrl = 'moz-extension://mock/',
  manifest = {},
} = {}) {
  /** @type {messenger.spaces.Space[]} */
  const spaces = BUILT_IN_SPACES.map((name, index) => ({
    id: index + 1,
    name,
    isBuiltIn: true,
    isSelfOwned: false,
  }));
  /** @type {Map<number, {url: string, button: messenger.spaces.SpaceButtonProperties}>} */
  const spaceProps = new Map();
  let nextSpaceId = spaces.length + 1;
  let nextTabId = 1;
  /** @type {messenger.tabs.Tab[]} */
  const tabs = [];

  /** @param {number} spaceId */
  const ownSpace = (spaceId) => {
    const space = spaces.find((s) => s.id === spaceId);
    if (!space || !space.isSelfOwned) throw new Error(`Invalid spaceId: ${spaceId}`);
    return space;
  };
  /** @param {string | messenger.spaces.SpaceTabProperties} props */
  const tabUrl = (props) => (typeof props === 'string' ? props : props.url);

  const spacesApi = {
    /** @type {typeof messenger.spaces.create} */
    async create(name, tabProperties, buttonProperties = {}) {
      if (!/^\w+$/.test(name)) throw new Error(`Invalid space name: ${name}`);
      if (spaces.some((s) => s.isSelfOwned && s.name === name)) {
        throw new Error(
          `Failed to create new space: The id ${name} is already used by this extension.`,
        );
      }
      const space = { id: nextSpaceId++, name, isBuiltIn: false, isSelfOwned: true };
      spaces.push(space);
      spaceProps.set(space.id, {
        url: tabUrl(tabProperties) ?? '',
        button: { ...buttonProperties },
      });
      return { ...space };
    },
    /** @type {typeof messenger.spaces.get} */
    async get(spaceId) {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) throw new Error(`Invalid spaceId: ${spaceId}`);
      return { ...space };
    },
    /** @type {typeof messenger.spaces.query} */
    async query(queryInfo = {}) {
      return spaces
        .filter(
          (s) =>
            (queryInfo.isBuiltIn === undefined || s.isBuiltIn === queryInfo.isBuiltIn) &&
            (queryInfo.isSelfOwned === undefined || s.isSelfOwned === queryInfo.isSelfOwned) &&
            (queryInfo.name === undefined || s.name === queryInfo.name) &&
            (queryInfo.spaceId === undefined || s.id === queryInfo.spaceId),
        )
        .map((s) => ({ ...s }));
    },
    /** @type {typeof messenger.spaces.open} */
    async open(spaceId, windowId = 1) {
      ownSpace(spaceId);
      const props = /** @type {{url: string}} */ (spaceProps.get(spaceId));
      let tab = tabs.find((t) => t.spaceId === spaceId);
      if (!tab) {
        tab = {
          id: nextTabId++,
          index: tabs.length,
          windowId,
          active: true,
          highlighted: true,
          selected: true,
          url: props.url,
          type: 'special',
          spaceId,
        };
        tabs.push(tab);
      }
      return { ...tab };
    },
    /** @type {typeof messenger.spaces.remove} */
    async remove(spaceId) {
      ownSpace(spaceId);
      spaces.splice(
        spaces.findIndex((s) => s.id === spaceId),
        1,
      );
      spaceProps.delete(spaceId);
    },
    /** @type {typeof messenger.spaces.update} */
    async update(spaceId, tabProperties, buttonProperties) {
      ownSpace(spaceId);
      const props = /** @type {{url: string, button: object}} */ (spaceProps.get(spaceId));
      const url =
        typeof tabProperties === 'string'
          ? tabProperties
          : 'url' in tabProperties
            ? tabProperties.url
            : undefined;
      if (url !== undefined) props.url = url;
      if (buttonProperties) props.button = { ...props.button, ...buttonProperties };
    },
    /** Test helper (not part of the API): the stored tab and button properties. */
    _props: (/** @type {number} */ spaceId) => spaceProps.get(spaceId),
  };

  /** @type {Record<string, any>} */
  const actionState = { badgeText: '', label: null, title: '', popup: '', enabled: true };
  /** @param {string} key */
  const getter = (key) => async () => actionState[key];
  /** @param {string} key @param {string} field */
  const setter = (key, field) => async (/** @type {Record<string, any>} */ details) => {
    actionState[key] = details[field];
  };

  const onMessage = createEvent();
  const runtime = {
    id: 'time-tracker@example.invalid',
    /** @param {string} path */
    getURL: (path) => new URL(path.replace(/^\//, ''), baseUrl).href,
    getManifest: () => structuredClone(manifest),
    getBrowserInfo: async () => ({
      name: 'Thunderbird',
      vendor: 'Mozilla',
      version: '157.0',
      buildID: 'mock',
    }),
    openOptionsPage: async () => {},
    /**
     * Delivers to this mock's own onMessage listeners (the mock plays the background).
     * Like the real API: rejects without listeners, resolves with the first response.
     * @param {any} message
     */
    async sendMessage(message) {
      const listeners = onMessage.dispatch(
        structuredClone(message),
        { id: runtime.id, url: globalThis.location?.href },
        () => {},
      );
      if (listeners.length === 0) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      const response = listeners.find((r) => r !== undefined && r !== false && r !== true);
      return structuredClone(await response);
    },
    onInstalled: createEvent(),
    onStartup: createEvent(),
    onSuspend: createEvent(),
    onMessage,
  };

  /** @param {string} areaName */
  const createStorageArea = (areaName) => {
    /** @type {Map<string, any>} */
    const data = new Map();
    const onChanged = createEvent();
    /** @param {Record<string, {oldValue?: any, newValue?: any}>} changes */
    const notify = (changes) => {
      if (Object.keys(changes).length === 0) return;
      onChanged.dispatch(changes);
      storageOnChanged.dispatch(changes, areaName);
    };
    return {
      /** @param {null | string | string[] | Record<string, any>} [keys] */
      async get(keys = null) {
        if (keys === null) return structuredClone(Object.fromEntries(data));
        if (typeof keys === 'string' || Array.isArray(keys)) {
          return structuredClone(
            Object.fromEntries(
              [keys]
                .flat()
                .filter((k) => data.has(k))
                .map((k) => [k, data.get(k)]),
            ),
          );
        }
        return structuredClone(
          Object.fromEntries(
            Object.entries(keys).map(([k, d]) => [k, data.has(k) ? data.get(k) : d]),
          ),
        );
      },
      /** @param {Record<string, any>} items */
      async set(items) {
        /** @type {Record<string, {oldValue?: any, newValue?: any}>} */
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data.get(key), newValue: structuredClone(value) };
          data.set(key, structuredClone(value));
        }
        notify(changes);
      },
      /** @param {string | string[]} keys */
      async remove(keys) {
        /** @type {Record<string, {oldValue?: any}>} */
        const changes = {};
        for (const key of [keys].flat()) {
          if (data.has(key)) changes[key] = { oldValue: data.get(key) };
          data.delete(key);
        }
        notify(changes);
      },
      async clear() {
        const changes = Object.fromEntries([...data].map(([k, v]) => [k, { oldValue: v }]));
        data.clear();
        notify(changes);
      },
      onChanged,
    };
  };
  const storageOnChanged = createEvent();

  /** @type {Map<string, messenger.alarms.Alarm>} */
  const alarms = new Map();
  /** @type {Map<string, any>} */
  const notifications = new Map();
  /** @type {Map<string | number, messenger.menus.CreateProperties>} */
  const menuItems = new Map();
  let nextMenuId = 1;
  /** Elements of recent contextmenu events, by targetElementId (see menus._contextMenu). */
  /** @type {Map<number, Element>} */
  const menuTargets = new Map();
  let nextTargetId = 1;

  /** @type {{overridden: object | null, lastTarget: number | null}} */
  const menuState = { overridden: null, lastTarget: null };

  return {
    spaces: spacesApi,
    action: {
      setBadgeText: setter('badgeText', 'text'),
      getBadgeText: getter('badgeText'),
      setBadgeBackgroundColor: setter('badgeBackgroundColor', 'color'),
      getBadgeBackgroundColor: getter('badgeBackgroundColor'),
      setBadgeTextColor: setter('badgeTextColor', 'color'),
      getBadgeTextColor: getter('badgeTextColor'),
      setLabel: setter('label', 'label'),
      getLabel: getter('label'),
      setTitle: setter('title', 'title'),
      getTitle: getter('title'),
      setPopup: setter('popup', 'popup'),
      getPopup: getter('popup'),
      setIcon: setter('icon', 'path'),
      enable: async () => void (actionState.enabled = true),
      disable: async () => void (actionState.enabled = false),
      isEnabled: getter('enabled'),
      openPopup: async () => true,
      onClicked: createEvent(),
    },
    runtime,
    storage: {
      local: createStorageArea('local'),
      session: createStorageArea('session'),
      onChanged: storageOnChanged,
    },
    alarms: {
      // Alarms are stored but never fire on their own; tests dispatch onAlarm explicitly.
      /** @param {string | messenger.alarms.AlarmInfo} nameOrInfo @param {messenger.alarms.AlarmInfo} [info] */
      create(nameOrInfo, info) {
        const [name, alarmInfo] =
          typeof nameOrInfo === 'string' ? [nameOrInfo, info ?? {}] : ['', nameOrInfo];
        const scheduledTime =
          alarmInfo.when ??
          Date.now() + (alarmInfo.delayInMinutes ?? alarmInfo.periodInMinutes ?? 0) * 60_000;
        alarms.set(name, { name, scheduledTime, periodInMinutes: alarmInfo.periodInMinutes });
      },
      get: async (name = '') => alarms.get(name),
      getAll: async () => [...alarms.values()],
      clear: async (name = '') => alarms.delete(name),
      clearAll: async () => {
        const had = alarms.size > 0;
        alarms.clear();
        return had;
      },
      onAlarm: createEvent(),
    },
    notifications: {
      /** @param {string | object} idOrOptions @param {object} [options] */
      async create(idOrOptions, options) {
        const id = typeof idOrOptions === 'string' ? idOrOptions : `n${notifications.size + 1}`;
        notifications.set(id, typeof idOrOptions === 'string' ? options : idOrOptions);
        return id;
      },
      /** @param {string} id */
      clear: async (id) => notifications.delete(id),
      getAll: async () => Object.fromEntries(notifications),
      onClicked: createEvent(),
      onClosed: createEvent(),
    },
    commands: {
      getAll: async () =>
        Object.entries(manifest.commands ?? {}).map(([name, c]) => ({
          name,
          description: c.description,
          shortcut: c.suggested_key?.default ?? '',
        })),
      update: async () => {},
      reset: async () => {},
      openShortcutSettings: async () => {},
      onCommand: createEvent(),
    },
    menus: {
      /** @param {messenger.menus.CreateProperties} props */
      create(props) {
        const id = props.id ?? nextMenuId++;
        if (menuItems.has(id)) throw new Error(`ID already exists: ${id}`);
        if (props.parentId !== undefined && !menuItems.has(props.parentId)) {
          throw new Error(`Could not find any MenuItem with id: ${props.parentId}`);
        }
        menuItems.set(id, { ...props, id: /** @type {string} */ (id) });
        return id;
      },
      /** @param {string | number} id @param {object} props */
      update: async (id, props) => {
        if (!menuItems.has(id)) throw new Error(`Could not find any MenuItem with id: ${id}`);
        menuItems.set(id, { ...menuItems.get(id), ...props });
      },
      /** @param {string | number} id */
      remove: async (id) => void menuItems.delete(id),
      removeAll: async () => menuItems.clear(),
      refresh: async () => {},
      /** @type {(options: {showDefaults?: boolean, context?: string}) => void} */
      overrideContext: (options) => {
        menuState.overridden = options;
      },
      /** @param {number} targetElementId */
      getTargetElement: (targetElementId) => {
        const element = menuTargets.get(targetElementId);
        return element?.isConnected ? element : null;
      },
      onClicked: createEvent(),
      onShown: createEvent(),
      onHidden: createEvent(),
      /**
       * Test helper (not part of the API): what Thunderbird does on a contextmenu event. Records
       * the target and returns its targetElementId; `overridden` is reset for the new menu.
       * @param {Element} target
       */
      _contextMenu(target) {
        const id = nextTargetId++;
        menuTargets.set(id, target);
        menuState.overridden = null;
        menuState.lastTarget = id;
        return id;
      },
      /** Test helper: state of the last menu (`overridden` options, `lastTarget` id). */
      _state: () => menuState,
      /** Test helper: a copy of every item. */
      _items: () => [...menuItems.values()].map((item) => ({ ...item })),
    },
    i18n: {
      /** @param {string} name @param {string | string[]} [substitutions] */
      getMessage: (name, substitutions) => formatMessage(messages, name, substitutions),
      getUILanguage: () => 'en',
      getAcceptLanguages: async () => ['en'],
    },
    tabs: {
      /** @param {number} tabId */
      async get(tabId) {
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Invalid tab ID: ${tabId}`);
        return { ...tab };
      },
      getCurrent: async () => tabs.find((t) => t.active),
      /** @param {{url?: string, active?: boolean}} props */
      async create(props) {
        /** @type {messenger.tabs.Tab} */
        const tab = {
          id: nextTabId++,
          index: tabs.length,
          windowId: 1,
          active: props.active ?? true,
          highlighted: false,
          selected: false,
          url: props.url,
          type: 'content',
        };
        tabs.push(tab);
        return { ...tab };
      },
      /** @param {number} tabId @param {{active?: boolean, url?: string}} props */
      async update(tabId, props) {
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Invalid tab ID: ${tabId}`);
        Object.assign(tab, props);
        return { ...tab };
      },
      /** @param {{spaceId?: number, active?: boolean}} [queryInfo] */
      query: async (queryInfo = {}) =>
        tabs.filter(
          (t) =>
            (queryInfo.spaceId === undefined || t.spaceId === queryInfo.spaceId) &&
            (queryInfo.active === undefined || t.active === queryInfo.active),
        ),
      /** @param {number | number[]} tabIds */
      async remove(tabIds) {
        for (const id of [tabIds].flat()) {
          const index = tabs.findIndex((t) => t.id === id);
          if (index >= 0) tabs.splice(index, 1);
        }
      },
      onActivated: createEvent(),
      onRemoved: createEvent(),
    },
  };
}

/**
 * Prepares the dev database from the page URL before the page script runs:
 * - default: seed fixtures (seed 42) only if the database doesn't exist yet, so changes survive
 *   reloads;
 * - `?seed=N`: re-seed with seed N; `?fixtures=empty`: delete everything; `?fixtures=bulk`:
 *   re-seed with 2,000 extra tasks in Support retainer (M4 performance fixture);
 *   `?fixtures=large`: re-seed with 300 tasks and 50,000 entries over 3 years (M7);
 * - `?density=` / `?accent=`: store those settings (for screenshots);
 * - `?fail=newer`: the stored database gets a newer schema version (VersionError on open);
 *   `?fail=quota`: every later IndexedDB write throws QuotaExceededError (M7 error bars).
 * @param {URLSearchParams} params
 */
export async function prepareDatabase(params) {
  const seed = params.get('seed');
  if (params.get('fixtures') === 'empty') await deleteDatabase();
  else if (params.get('fixtures') === 'bulk') {
    await seedDatabase(generateFixtures({ seed: Number(seed ?? 42) }, { bulkTasks: 2000 }));
  } else if (params.get('fixtures') === 'large') {
    const options = { seed: Number(seed ?? 42) };
    // 16 reference tasks + 284 = 300 tasks; 50,000 entries in all.
    const base = generateFixtures(options).entries.length;
    await seedDatabase(generateFixtures(options, { largeTasks: 284, largeEntries: 50_000 - base }));
  } else if (seed !== null || !(await databaseExists())) {
    await seedDatabase(generateFixtures({ seed: Number(seed ?? 42) }));
  }
  /** @type {Record<string, string>} */
  const settings = {};
  for (const name of ['density', 'accent']) {
    const value = params.get(name);
    if (value) settings[name] = value;
  }
  if (Object.keys(settings).length > 0) await seedSettings(settings);
  const fail = params.get('fail');
  if (fail === 'newer') await bumpVersion();
  if (fail === 'quota') failWrites();
}

/** Upgrades the stored database to a version this code doesn't know. */
function bumpVersion() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1000);
    request.onsuccess = () => {
      request.result.close();
      resolve(undefined);
    };
    request.onerror = () => reject(request.error);
  });
}

/** Makes every IndexedDB write fail like a full disk. */
function failWrites() {
  for (const method of /** @type {const} */ (['put', 'add', 'delete', 'clear'])) {
    IDBObjectStore.prototype[method] = () => {
      throw new DOMException('The disk is full (dev ?fail=quota)', 'QuotaExceededError');
    };
  }
}

/**
 * Browser entry: installs the globals, registers the context menu items and prepares the database.
 * scripts/serve.mjs awaits this before importing the page's own module script.
 */
async function boot() {
  const data = document.getElementById('tt-dev-messages');
  const api = createMessenger({
    messages: data ? JSON.parse(data.textContent ?? '{}') : {},
    baseUrl: `${location.origin}/`,
  });
  Object.assign(globalThis, { messenger: api, browser: api });
  // Like Thunderbird, record the target before the page's own contextmenu listeners run.
  window.addEventListener(
    'contextmenu',
    (event) => api.menus._contextMenu(/** @type {Element} */ (event.target)),
    { capture: true },
  );
  await registerMenus(/** @type {any} */ (api));
  // The gallery renders from in-memory fixtures and needs no database.
  if (!location.pathname.startsWith('/dev/')) {
    await prepareDatabase(new URLSearchParams(location.search));
  }
  // Tests can tell the harness's own database work from the page's.
  document.documentElement.dataset.devReady = '';
}

export const ready =
  typeof document !== 'undefined' && !('messenger' in globalThis) ? boot() : Promise.resolve();
