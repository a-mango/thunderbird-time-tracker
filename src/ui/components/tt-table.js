import { getLayout, setLayout } from '../layout-store.js';
import { el, icon, renderList, setAttrs } from '../render.js';

const MIN_WIDTH = 40;
const MAX_WIDTH = 1000;
const RESIZE_STEP = 10;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 10;
/** A focused row this far outside the visible window is still kept rendered. */
const KEEP_FOCUSED = 300;

/**
 * @template [T=any]
 * @typedef {object} TableColumn
 * @property {string} id
 * @property {string} label header text; for icon columns it is the accessible name
 * @property {string} [icon] header icon (from src/ui/icons) shown instead of the label
 * @property {number | string} [width] px (resizable), or a CSS length such as
 *   `var(--table-header-cell-icon-width)` (fixed); columns without a width share the rest
 * @property {number} [minWidth] px (default 40)
 * @property {'start' | 'end' | 'center'} [align] cell alignment (time columns: `end`)
 * @property {boolean} [numeric] cells use tabular-nums (implied by `align: 'end'`)
 * @property {(a: T, b: T) => number} [compare] makes the column sortable
 * @property {boolean} [hidden] initial state when nothing is persisted
 * @property {boolean} [required] cannot be hidden from the column picker
 */

/**
 * @typedef {object} TableLayout
 * @property {Record<string, number>} widths
 * @property {string[]} hidden
 * @property {{column: string, direction: 'ascending' | 'descending'} | null} sort
 */

/**
 * ARIA treegrid after Thunderbird's thread pane table view (tree-listbox.css, threadPane.css;
 * Thunderbird's table body is a treegrid too, because rows, not cells, take focus).
 * Renders a native `<table role="treegrid">` with sortable header buttons, a column picker
 * (`column-menu` icon, popover menu of checkboxes) and resizable fixed-width columns.
 * Single selection with a roving tabindex on rows; selection follows focus.
 * Virtualized like Thunderbird's tree-view-table: only the visible rows (plus a margin) are in
 * the DOM, between two spacer bodies; `aria-rowcount`/`aria-rowindex` give the real positions.
 *
 * Attributes: `label` (required, the grid's accessible name, localized by the page);
 * `persist` = layout-store key for widths, hidden columns and sort.
 *
 * Keyboard on rows: Up/Down, Home/End, PageUp/PageDown, Enter (activate).
 * Header: Tab to the sort buttons and resizers; resizers take Left/Right (Shift = bigger).
 * Column picker menu: Up/Down, Space/Enter toggles, Escape closes.
 *
 * Events (bubbling): `tt-select` {key}, `tt-activate` {key}, `tt-sort` {column, direction},
 * `tt-columns` {layout}.
 * @template [T=any]
 */
export class TtTable extends HTMLElement {
  /** @type {TableColumn<T>[]} */
  #columns = [];
  /** @type {T[]} */
  #rows = [];
  /** @type {TableLayout} */
  #layout = { widths: {}, hidden: [], sort: null };
  /** @type {unknown} */
  #selectedKey = null;
  #table = el('table', { attrs: { role: 'treegrid' } });
  #colgroup = el('colgroup');
  #headRow = el('tr');
  #body = el('tbody');
  #before = el(
    'tbody',
    { class: 'spacer', attrs: { role: 'presentation' } },
    el('tr', {}, el('td')),
  );
  #after = el(
    'tbody',
    { class: 'spacer', attrs: { role: 'presentation' } },
    el('tr', {}, el('td')),
  );
  /** @type {T[]} rows in display order */
  #sorted = [];
  /** @type {Map<unknown, number>} row key → index in #sorted */
  #index = new Map();
  /** @type {Map<string, unknown>} `data-key` → row key */
  #keys = new Map();
  #window = { start: 0, end: 0 };
  #rowHeight = 0;
  #frame = 0;
  /** @type {ResizeObserver | null} */
  #resize = null;
  #pickerButton = el('button', {
    class: 'icon-button column-picker',
    type: 'button',
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
  });
  #menu = el('div', { class: 'tt-menu', attrs: { role: 'menu', popover: 'auto' } });

  /** Key of a row (must be unique). @type {(row: T) => unknown} */
  rowKey = (row) => /** @type {any} */ (row).id;

  /**
   * Fills a cell. Default: the row's property named like the column, as text.
   * @type {(row: T, column: TableColumn<T>, cell: HTMLTableCellElement) => void}
   */
  renderCell = (row, column, cell) => {
    const value = /** @type {any} */ (row)[column.id];
    cell.textContent = value === null || value === undefined ? '' : String(value);
  };

  /**
   * Called after each row render, e.g. to set classes for states like "running".
   * @type {(row: T, tr: HTMLTableRowElement) => void}
   */
  renderRow = () => {};

  static observedAttributes = ['label'];

  attributeChangedCallback() {
    this.#table.setAttribute('aria-label', this.getAttribute('label') ?? '');
  }

  connectedCallback() {
    if (!this.#table.isConnected) {
      this.#table.append(
        this.#colgroup,
        el('thead', {}, this.#headRow),
        this.#before,
        this.#body,
        this.#after,
      );
      const label = messenger.i18n.getMessage('tableColumnPicker');
      this.#pickerButton.setAttribute('aria-label', label);
      this.#pickerButton.title = label;
      this.#pickerButton.append(icon('column-menu', { class: 'small' }));
      this.#menu.id = `tt-menu-${crypto.randomUUID()}`;
      this.#pickerButton.setAttribute('aria-controls', this.#menu.id);
      this.#pickerButton.id = `${this.#menu.id}-button`;
      this.#menu.setAttribute('aria-labelledby', this.#pickerButton.id);
      this.append(el('div', { class: 'scroll' }, this.#table), this.#pickerButton, this.#menu);
    }
    this.#table.setAttribute('aria-label', this.getAttribute('label') ?? '');
    this.#body.addEventListener('keydown', this.#onBodyKeyDown);
    this.#body.addEventListener('click', this.#onBodyClick);
    this.#body.addEventListener('dblclick', this.#onBodyDblClick);
    this.#pickerButton.addEventListener('click', this.#openMenu);
    this.#menu.addEventListener('keydown', this.#onMenuKeyDown);
    this.#menu.addEventListener('toggle', this.#onMenuToggle);
    this.#scroller.addEventListener('scroll', this.#onScroll, { passive: true });
    this.#resize = new ResizeObserver(this.#onScroll);
    this.#resize.observe(this.#scroller);
  }

  disconnectedCallback() {
    this.#body.removeEventListener('keydown', this.#onBodyKeyDown);
    this.#body.removeEventListener('click', this.#onBodyClick);
    this.#body.removeEventListener('dblclick', this.#onBodyDblClick);
    this.#pickerButton.removeEventListener('click', this.#openMenu);
    this.#menu.removeEventListener('keydown', this.#onMenuKeyDown);
    this.#menu.removeEventListener('toggle', this.#onMenuToggle);
    this.#scroller.removeEventListener('scroll', this.#onScroll);
    this.#resize?.disconnect();
    cancelAnimationFrame(this.#frame);
  }

  /** The scrolling box around the table. */
  get #scroller() {
    return /** @type {HTMLElement} */ (this.#table.parentElement);
  }

  /** @returns {TableColumn<T>[]} */
  get columns() {
    return this.#columns;
  }

  /** Sets the columns; persisted widths, hidden columns and sort are applied on top. */
  set columns(columns) {
    this.#columns = columns;
    const persist = this.getAttribute('persist');
    const stored = /** @type {Partial<TableLayout> | undefined} */ (
      persist ? getLayout(persist) : undefined
    );
    const ids = new Set(columns.map((c) => c.id));
    this.#layout = {
      // Persisted values are untrusted: keep only well-formed entries.
      widths: Object.fromEntries(
        Object.entries(stored?.widths ?? {}).filter(
          ([id, w]) => ids.has(id) && typeof w === 'number' && Number.isFinite(w),
        ),
      ),
      hidden: Array.isArray(stored?.hidden)
        ? stored.hidden.filter((id) => typeof id === 'string' && ids.has(id))
        : columns.filter((c) => c.hidden).map((c) => c.id),
      sort:
        stored?.sort &&
        ids.has(stored.sort.column) &&
        (stored.sort.direction === 'ascending' || stored.sort.direction === 'descending')
          ? { column: stored.sort.column, direction: stored.sort.direction }
          : this.#layout.sort,
    };
    this.#renderHead();
    this.#renderBody();
  }

  /** @returns {T[]} rows in their given (unsorted) order */
  get rows() {
    return this.#rows;
  }

  set rows(rows) {
    this.#rows = rows;
    if (this.#selectedKey !== null && !rows.some((r) => this.rowKey(r) === this.#selectedKey)) {
      this.#selectedKey = null;
    }
    this.#renderBody();
  }

  /** Current sort, or null. Setting it re-sorts without firing `tt-sort`. */
  get sort() {
    return this.#layout.sort;
  }

  set sort(sort) {
    this.#layout.sort = sort;
    this.#renderHead();
    this.#renderBody();
  }

  get selectedKey() {
    return this.#selectedKey;
  }

  set selectedKey(key) {
    // An unknown key would leave no row tabbable.
    this.#selectedKey = this.#index.has(key) ? key : null;
    this.#syncRowStates();
  }

  /** Updates tabindex and aria-selected of rendered rows (the cells stay as they are). */
  #syncRowStates() {
    const rows = [...this.#body.rows];
    const selected = this.#selectedKey === null ? null : String(this.#selectedKey);
    const tabbable = rows.some((tr) => tr.dataset.key === selected)
      ? selected
      : (rows[0]?.dataset.key ?? null);
    for (const tr of rows) {
      tr.tabIndex = tr.dataset.key === tabbable ? 0 : -1;
      tr.setAttribute('aria-selected', String(tr.dataset.key === selected));
    }
  }

  /** Columns currently shown, in order. */
  get visibleColumns() {
    return this.#columns.filter((c) => !this.#layout.hidden.includes(c.id));
  }

  /** @param {string} id @param {boolean} visible */
  setColumnVisible(id, visible) {
    const column = this.#columns.find((c) => c.id === id);
    if (!column || column.required) return;
    const hidden = this.#layout.hidden.filter((h) => h !== id);
    if (!visible) hidden.push(id);
    this.#layout.hidden = hidden;
    this.#saveLayout();
    this.#renderHead();
    this.#renderBody();
  }

  /** Focuses the selected row (or the first). */
  focusSelected() {
    const rows = this.#sorted;
    const key = this.#selectedKey ?? (rows[0] ? this.rowKey(rows[0]) : null);
    if (key !== null) this.#focusRow(key);
  }

  #saveLayout() {
    const persist = this.getAttribute('persist');
    if (persist) setLayout(persist, this.#layout);
    this.dispatchEvent(
      new CustomEvent('tt-columns', { bubbles: true, detail: { layout: this.#layout } }),
    );
  }

  /** @param {TableColumn<T>} column */
  #width(column) {
    return this.#layout.widths[column.id] ?? column.width;
  }

  #sortedRows() {
    const sort = this.#layout.sort;
    const column = sort && this.#columns.find((c) => c.id === sort.column);
    if (!sort || !column?.compare) return this.#rows;
    const compare = column.compare;
    const sign = sort.direction === 'descending' ? -1 : 1;
    return [...this.#rows].sort((a, b) => sign * compare(a, b));
  }

  #renderHead() {
    const columns = this.visibleColumns;
    renderList(
      this.#colgroup,
      columns,
      (c) => c.id,
      () => el('col'),
      () => {},
    ).forEach((col, i) => {
      const width = this.#width(columns[i]);
      col.style.inlineSize = typeof width === 'number' ? `${width}px` : (width ?? '');
    });
    const ths = renderList(
      this.#headRow,
      columns,
      (c) => c.id,
      (column) => this.#createHeader(column),
      () => {},
    );
    ths.forEach((th, i) => {
      const column = columns[i];
      const sort = this.#layout.sort;
      if (column.compare && sort?.column === column.id)
        th.setAttribute('aria-sort', sort.direction);
      else th.removeAttribute('aria-sort');
      th.classList.toggle('last-column', i === columns.length - 1);
      const resizer = /** @type {HTMLElement | null} */ (th.querySelector('.resizer'));
      if (resizer) {
        setAttrs(resizer, {
          'aria-valuenow': this.#width(column),
          hidden: i === columns.length - 1,
        });
      }
    });
    this.#renderMenu();
  }

  /** @param {TableColumn<T>} column */
  #createHeader(column) {
    const th = el('th', {
      attrs: { role: 'columnheader', scope: 'col', 'data-column': column.id },
      class: column.icon ? 'icon-column' : '',
    });
    if (column.align) th.dataset.align = column.align;
    const content = column.icon
      ? icon(column.icon, { label: column.label })
      : el('span', { class: 'label', text: column.label });
    if (column.compare) {
      const button = el(
        'button',
        { class: 'header-button', type: 'button', on: { click: () => this.#toggleSort(column) } },
        content,
        icon('nav-up-xs', { class: 'small sort-icon ascending' }),
        icon('nav-down-xs', { class: 'small sort-icon descending' }),
      );
      if (column.icon) button.title = column.label;
      th.append(button);
    } else {
      th.append(el('span', { class: 'header-button' }, content));
    }
    if (typeof this.#width(column) === 'number') th.append(this.#createResizer(column, th));
    return th;
  }

  /** @param {TableColumn<T>} column @param {HTMLTableCellElement} th */
  #createResizer(column, th) {
    const resizer = el('span', {
      class: 'resizer',
      tabIndex: 0,
      attrs: {
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': messenger.i18n.getMessage('tableResizeColumn', column.label),
        'aria-valuemin': column.minWidth ?? MIN_WIDTH,
        'aria-valuemax': MAX_WIDTH,
      },
    });
    /** @param {number} width */
    const resize = (width) => {
      this.#layout.widths[column.id] = Math.min(
        MAX_WIDTH,
        Math.max(column.minWidth ?? MIN_WIDTH, Math.round(width)),
      );
      this.#renderHead();
    };
    const rtl = () => getComputedStyle(this).direction === 'rtl';
    resizer.addEventListener('keydown', (event) => {
      const step = (event.shiftKey ? 5 : 1) * RESIZE_STEP * (rtl() ? -1 : 1);
      const width = Number(this.#width(column) ?? th.getBoundingClientRect().width);
      if (event.key === 'ArrowLeft') resize(width - step);
      else if (event.key === 'ArrowRight') resize(width + step);
      else return;
      event.preventDefault();
      this.#saveLayout();
    });
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizer.focus();
      resizer.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = Number(this.#width(column) ?? th.getBoundingClientRect().width);
      /** @param {PointerEvent} move */
      const onMove = (move) => resize(startWidth + (move.clientX - startX) * (rtl() ? -1 : 1));
      const onUp = () => {
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        resizer.removeEventListener('pointercancel', onUp);
        this.#saveLayout();
      };
      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
      resizer.addEventListener('pointercancel', onUp);
    });
    return resizer;
  }

  /** @param {TableColumn<T>} column */
  #toggleSort(column) {
    const current = this.#layout.sort;
    /** @type {'ascending' | 'descending'} */
    const direction =
      current?.column === column.id && current.direction === 'ascending'
        ? 'descending'
        : 'ascending';
    this.#layout.sort = { column: column.id, direction };
    this.#saveLayout();
    this.#renderHead();
    this.#renderBody();
    this.dispatchEvent(
      new CustomEvent('tt-sort', { bubbles: true, detail: { column: column.id, direction } }),
    );
  }

  #renderBody() {
    const rows = this.#sortedRows();
    this.#sorted = rows;
    this.#index = new Map();
    this.#keys = new Map();
    rows.forEach((row, i) => {
      const key = this.rowKey(row);
      this.#index.set(key, i);
      this.#keys.set(String(key), key);
    });
    this.#table.setAttribute('aria-rowcount', String(rows.length + 1));
    this.#renderWindow(true);
  }

  /** Height of one body row (they all share `--tree-row-height`). */
  #measureRowHeight() {
    const row = this.#body.rows[0];
    const height = row?.getBoundingClientRect().height ?? 0;
    if (height > 0) this.#rowHeight = height;
    return this.#rowHeight || 28;
  }

  /**
   * Renders the rows that are visible (plus OVERSCAN on each side, plus the focused row if it is
   * close). `refresh`: data changed, so kept rows are filled again; otherwise (scrolling) only
   * rows entering the window are.
   * @param {boolean} refresh
   */
  #renderWindow(refresh) {
    const rows = this.#sorted;
    const scroller = this.#scroller;
    const height = this.#rowHeight || this.#measureRowHeight();
    const viewport = scroller?.clientHeight || 1000;
    let start = Math.max(0, Math.floor((scroller?.scrollTop ?? 0) / height) - OVERSCAN);
    let end = Math.min(rows.length, start + Math.ceil(viewport / height) + 2 * OVERSCAN);
    if (start >= end) start = Math.max(0, end - Math.ceil(viewport / height) - OVERSCAN);
    const focused = this.#body.contains(document.activeElement)
      ? this.#index.get(this.#selectedKey)
      : undefined;
    if (focused !== undefined && focused >= start - KEEP_FOCUSED && focused < end + KEEP_FOCUSED) {
      start = Math.min(start, focused);
      end = Math.max(end, focused + 1);
    }
    if (!refresh && start === this.#window.start && end === this.#window.end) return;
    this.#window = { start, end };

    const columns = this.visibleColumns;
    const visible = rows.slice(start, end);
    const keys = visible.map(this.rowKey);
    const tabbable =
      this.#selectedKey !== null && keys.includes(this.#selectedKey)
        ? this.#selectedKey
        : (keys[0] ?? null);
    /** @type {Set<Element>} */
    const fresh = new Set();
    renderList(
      this.#body,
      visible,
      this.rowKey,
      () => {
        const tr = el('tr', { attrs: { role: 'row' } });
        fresh.add(tr);
        return tr;
      },
      () => {},
    ).forEach((tr, i) => {
      const row = visible[i];
      const key = keys[i];
      tr.dataset.key = String(key);
      tr.tabIndex = key === tabbable ? 0 : -1;
      tr.setAttribute('aria-selected', String(key === this.#selectedKey));
      tr.setAttribute('aria-rowindex', String(start + i + 2));
      if (!refresh && !fresh.has(tr)) return;
      tr.replaceChildren(
        ...columns.map((column) => {
          const cell = el('td', { attrs: { role: 'gridcell' }, dataset: { column: column.id } });
          if (column.align) cell.dataset.align = column.align;
          if (column.numeric || column.align === 'end') cell.classList.add('num');
          if (column.icon) cell.classList.add('icon-column');
          this.renderCell(row, column, cell);
          return cell;
        }),
      );
      this.renderRow(row, tr);
    });
    const measured = this.#measureRowHeight();
    for (const [spacer, count] of /** @type {const} */ ([
      [this.#before, start],
      [this.#after, rows.length - end],
    ])) {
      spacer.hidden = count === 0;
      const tr = /** @type {HTMLTableRowElement} */ (spacer.firstElementChild);
      tr.style.blockSize = `${count * measured}px`;
      /** @type {HTMLTableCellElement} */ (tr.firstElementChild).colSpan = columns.length || 1;
    }
  }

  #onScroll = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#renderWindow(false));
  };

  /** @param {unknown} key */
  #rowElement(key) {
    return /** @type {HTMLTableRowElement | undefined} */ (
      [...this.#body.rows].find((tr) => tr.dataset.key === String(key))
    );
  }

  /** Renders the row of `key` if it is outside the window, scrolling it into view. @param {unknown} key */
  #ensureRendered(key) {
    if (this.#rowElement(key)) return;
    const index = this.#index.get(key);
    if (index === undefined) return;
    const scroller = this.#scroller;
    const height = this.#rowHeight || this.#measureRowHeight();
    scroller.scrollTop = Math.max(0, index * height - scroller.clientHeight / 2);
    this.#renderWindow(false);
  }

  /** @param {unknown} key */
  #focusRow(key) {
    this.#ensureRendered(key);
    if (this.#selectedKey !== key) {
      this.#selectedKey = key;
      // Only the selection changed: update row states without re-rendering cells.
      for (const tr of this.#body.rows) {
        const selected = tr.dataset.key === String(key);
        tr.tabIndex = selected ? 0 : -1;
        tr.setAttribute('aria-selected', String(selected));
      }
      this.dispatchEvent(new CustomEvent('tt-select', { bubbles: true, detail: { key } }));
    }
    const tr = this.#rowElement(key);
    tr?.focus();
    tr?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {Event} event */
  #keyFromEvent(event) {
    const tr = /** @type {HTMLTableRowElement | null} */ (
      /** @type {Element} */ (event.target).closest('tr')
    );
    if (!tr || tr.parentElement !== this.#body) return undefined;
    return this.#keys.get(tr.dataset.key ?? '');
  }

  /** @param {MouseEvent} event */
  #onBodyClick = (event) => {
    const key = this.#keyFromEvent(event);
    if (key !== undefined) this.#focusRow(key);
  };

  /** @param {MouseEvent} event */
  #onBodyDblClick = (event) => {
    const key = this.#keyFromEvent(event);
    if (key !== undefined) {
      this.dispatchEvent(new CustomEvent('tt-activate', { bubbles: true, detail: { key } }));
    }
  };

  /** @param {KeyboardEvent} event */
  #onBodyKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Keys on controls inside a cell (star, start/stop buttons) are theirs.
    if (/** @type {Element} */ (event.target).localName !== 'tr') return;
    const keys = this.#sorted.map(this.rowKey);
    const current = this.#keyFromEvent(event);
    if (current === undefined || keys.length === 0) return;
    const index = this.#index.get(current) ?? 0;
    const firstRow = this.#body.rows[0];
    const scroller = /** @type {HTMLElement} */ (this.#table.parentElement);
    const page = Math.max(
      1,
      Math.floor(scroller.clientHeight / (firstRow?.getBoundingClientRect().height || 1)) - 1,
    );
    /** @type {number | undefined} */
    let target;
    switch (event.key) {
      case 'ArrowDown':
        target = index + 1;
        break;
      case 'ArrowUp':
        target = index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = keys.length - 1;
        break;
      case 'PageDown':
        target = index + page;
        break;
      case 'PageUp':
        target = index - page;
        break;
      case 'Enter':
        event.preventDefault();
        this.dispatchEvent(
          new CustomEvent('tt-activate', { bubbles: true, detail: { key: current } }),
        );
        return;
      default:
        return;
    }
    event.preventDefault();
    this.#focusRow(keys[Math.max(0, Math.min(keys.length - 1, target))]);
  };

  #renderMenu() {
    const items = renderList(
      this.#menu,
      this.#columns,
      (c) => c.id,
      (column) =>
        el(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            tabIndex: -1,
            attrs: { role: 'menuitemcheckbox' },
            on: { click: () => this.#toggleColumn(column.id) },
          },
          icon('check', { class: 'check' }),
          el('span', { class: 'label' }),
        ),
      () => {},
    );
    items.forEach((item, i) => {
      const column = this.#columns[i];
      /** @type {HTMLElement} */ (item.lastElementChild).textContent = column.label;
      setAttrs(item, {
        'aria-checked': String(!this.#layout.hidden.includes(column.id)),
        'aria-disabled': column.required ? 'true' : null,
      });
    });
  }

  /** @param {string} id */
  #toggleColumn(id) {
    const column = this.#columns.find((c) => c.id === id);
    if (!column || column.required) return;
    const focused = this.#menu.querySelector(':focus');
    this.setColumnVisible(id, this.#layout.hidden.includes(id));
    /** @type {HTMLElement | null} */ (focused)?.focus();
  }

  #openMenu = () => {
    const rect = this.#pickerButton.getBoundingClientRect();
    this.#menu.style.insetBlockStart = `${rect.bottom}px`;
    this.#menu.style.insetInlineEnd = `${document.documentElement.clientWidth - rect.right}px`;
    this.#menu.showPopover();
    /** @type {HTMLElement | null} */ (this.#menu.querySelector('.menu-item'))?.focus();
  };

  /** @param {Event} event */
  #onMenuToggle = (event) => {
    const open = /** @type {ToggleEvent} */ (event).newState === 'open';
    this.#pickerButton.setAttribute('aria-expanded', String(open));
  };

  /** @param {KeyboardEvent} event */
  #onMenuKeyDown = (event) => {
    const items = /** @type {HTMLElement[]} */ ([...this.#menu.querySelectorAll('.menu-item')]);
    const index = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    /** @type {number | undefined} */
    let target;
    if (event.key === 'ArrowDown') target = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') target = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      this.#menu.hidePopover();
      this.#pickerButton.focus();
      return;
    } else return;
    event.preventDefault();
    items[target]?.focus();
  };
}

customElements.define('tt-table', TtTable);
