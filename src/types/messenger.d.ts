// Minimal typings for the Thunderbird WebExtension APIs this extension uses.
// Hand-written from .ref/webext-docs (branch release-mv3, Thunderbird 157).
// Only the members we call or are likely to call soon; extend from the .rst
// files when a milestone needs more. Not shipped (excluded from the XPI).

interface WebExtEvent<TCallback extends (...args: any[]) => any> {
  addListener(cb: TCallback): void;
  removeListener(cb: TCallback): void;
  hasListener(cb: TCallback): boolean;
}

declare namespace messenger {
  /** spaces.rst */
  namespace spaces {
    type ColorArray = [number, number, number, number];
    interface Space {
      id: number;
      name: string;
      isBuiltIn: boolean;
      isSelfOwned: boolean;
      extensionId?: string;
    }
    interface SpaceTabProperties {
      url?: string;
      linkHandler?: 'balanced' | 'relaxed' | 'strict';
      cookieStoreId?: string;
    }
    interface SpaceButtonProperties {
      title?: string | null;
      badgeText?: string | null;
      badgeBackgroundColor?: string | ColorArray | null;
      defaultIcons?: string | Record<string, string> | null;
      themeIcons?: { dark: string; light: string; size: number }[] | null;
    }
    interface QueryInfo {
      extensionId?: string;
      isBuiltIn?: boolean;
      isSelfOwned?: boolean;
      name?: string;
      spaceId?: number;
    }
    function create(
      name: string,
      tabProperties: string | SpaceTabProperties,
      buttonProperties?: SpaceButtonProperties,
    ): Promise<Space>;
    function get(spaceId: number): Promise<Space>;
    function open(spaceId: number, windowId?: number): Promise<tabs.Tab>;
    function query(queryInfo?: QueryInfo): Promise<Space[]>;
    function remove(spaceId: number): Promise<void>;
    function update(
      spaceId: number,
      tabProperties: string | SpaceTabProperties | SpaceButtonProperties,
      buttonProperties?: SpaceButtonProperties,
    ): Promise<void>;
  }

  /** action.rst (MV3 replacement of browserAction) */
  namespace action {
    type ColorArray = [number, number, number, number];
    interface Details {
      tabId?: number;
      windowId?: number;
    }
    function setBadgeText(details: Details & { text: string | null }): Promise<void>;
    function getBadgeText(details: Details): Promise<string>;
    function setBadgeBackgroundColor(
      details: Details & { color: string | ColorArray | null },
    ): Promise<void>;
    function setBadgeTextColor(
      details: Details & { color: string | ColorArray | null },
    ): Promise<void>;
    function setLabel(details: Details & { label: string | null }): Promise<void>;
    function getLabel(details: Details): Promise<string>;
    function setTitle(details: Details & { title: string | null }): Promise<void>;
    function getTitle(details: Details): Promise<string>;
    function setPopup(details: Details & { popup: string | null }): Promise<void>;
    function getPopup(details: Details): Promise<string>;
    function setIcon(
      details: Details & { path?: string | Record<string, string>; imageData?: unknown },
    ): Promise<void>;
    function enable(tabId?: number): Promise<void>;
    function disable(tabId?: number): Promise<void>;
    function isEnabled(details: Details): Promise<boolean>;
    function openPopup(options?: { windowId?: number }): Promise<boolean>;
    const onClicked: WebExtEvent<
      (tab: tabs.Tab, info?: { button?: number; modifiers: string[] }) => void
    >;
  }

  /** runtime.rst */
  namespace runtime {
    type OnInstalledReason = 'install' | 'update' | 'browser_update';
    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      origin?: string;
    }
    function getURL(path: string): string;
    function getManifest(): Record<string, any>;
    function sendMessage(message: any, options?: object): Promise<any>;
    function openOptionsPage(): Promise<void>;
    function getBrowserInfo(): Promise<{
      name: string;
      vendor: string;
      version: string;
      buildID: string;
    }>;
    const id: string;
    const onInstalled: WebExtEvent<
      (details: { reason: OnInstalledReason; temporary: boolean; previousVersion?: string }) => void
    >;
    const onStartup: WebExtEvent<() => void>;
    const onSuspend: WebExtEvent<() => void>;
    /** Return a Promise to respond asynchronously (guides/runtimeMessaging.rst). */
    const onMessage: WebExtEvent<
      (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => any
    >;
  }

  /** storage.rst */
  namespace storage {
    interface StorageChange {
      oldValue?: any;
      newValue?: any;
    }
    interface StorageArea {
      get(keys?: null | string | string[] | Record<string, any>): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
      onChanged: WebExtEvent<(changes: Record<string, StorageChange>) => void>;
    }
    const local: StorageArea;
    const session: StorageArea;
    const onChanged: WebExtEvent<
      (changes: Record<string, StorageChange>, areaName: string) => void
    >;
  }

  /** alarms.rst */
  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    interface AlarmInfo {
      when?: number;
      delayInMinutes?: number;
      periodInMinutes?: number;
    }
    function create(name: string, alarmInfo: AlarmInfo): void;
    function create(alarmInfo: AlarmInfo): void;
    function get(name?: string): Promise<Alarm | undefined>;
    function getAll(): Promise<Alarm[]>;
    function clear(name?: string): Promise<boolean>;
    function clearAll(): Promise<boolean>;
    const onAlarm: WebExtEvent<(alarm: Alarm) => void>;
  }

  /** commands.rst */
  namespace commands {
    interface Command {
      name?: string;
      description?: string;
      shortcut?: string;
    }
    function getAll(): Promise<Command[]>;
    function update(detail: {
      name: string;
      description?: string;
      shortcut?: string;
    }): Promise<void>;
    function reset(name: string): Promise<void>;
    function openShortcutSettings(): Promise<void>;
    const onCommand: WebExtEvent<(command: string, tab: tabs.Tab) => void>;
  }

  /** menus.rst */
  namespace menus {
    type ContextType = string;
    interface CreateProperties {
      id?: string;
      type?: 'normal' | 'checkbox' | 'radio' | 'separator';
      title?: string;
      contexts?: ContextType[];
      documentUrlPatterns?: string[];
      parentId?: string | number;
      enabled?: boolean;
      visible?: boolean;
      checked?: boolean;
      icons?: Record<string, string>;
      command?: string;
      viewTypes?: ('tab' | 'popup' | 'sidebar')[];
    }
    interface OnClickData {
      menuItemId: string | number;
      parentMenuItemId?: string | number;
      modifiers: string[];
      checked?: boolean;
      wasChecked?: boolean;
      pageUrl?: string;
    }
    function create(createProperties: CreateProperties, callback?: () => void): string | number;
    function update(
      id: string | number,
      updateProperties: Omit<CreateProperties, 'id'>,
    ): Promise<void>;
    function remove(menuItemId: string | number): Promise<void>;
    function removeAll(): Promise<void>;
    function refresh(): Promise<void>;
    function overrideContext(contextOptions: { showDefaults?: boolean; context?: string }): void;
    const onClicked: WebExtEvent<(info: OnClickData, tab?: tabs.Tab) => void>;
    const onShown: WebExtEvent<
      (
        info: OnClickData & { menuIds: (string | number)[]; contexts: ContextType[] },
        tab: tabs.Tab,
      ) => void
    >;
    const onHidden: WebExtEvent<() => void>;
  }

  /** i18n.rst */
  namespace i18n {
    function getMessage(messageName: string, substitutions?: string | string[]): string;
    function getUILanguage(): string;
    function getAcceptLanguages(): Promise<string[]>;
  }

  /** tabs.rst */
  namespace tabs {
    interface Tab {
      id?: number;
      index: number;
      windowId?: number;
      active: boolean;
      highlighted: boolean;
      selected: boolean;
      status?: string;
      title?: string;
      url?: string;
      type?: string;
      spaceId?: number;
    }
    function get(tabId: number): Promise<Tab>;
    function getCurrent(): Promise<Tab | undefined>;
    function create(createProperties: {
      url?: string;
      active?: boolean;
      index?: number;
      windowId?: number;
    }): Promise<Tab>;
    function update(
      tabId: number,
      updateProperties: { active?: boolean; url?: string },
    ): Promise<Tab>;
    function query(queryInfo?: {
      active?: boolean;
      currentWindow?: boolean;
      spaceId?: number;
      type?: string | string[];
      url?: string | string[];
      windowId?: number;
    }): Promise<Tab[]>;
    function remove(tabIds: number | number[]): Promise<void>;
    const onActivated: WebExtEvent<
      (activeInfo: { tabId: number; windowId: number; previousTabId?: number }) => void
    >;
    const onRemoved: WebExtEvent<
      (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void
    >;
  }
}

declare const browser: typeof messenger;
