import { getLayout, setLayout } from '../layout-store.js';
import { el, icon, renderList, setAttrs } from '../render.js';

const TYPE_AHEAD_MS = 500;
/** Hovering a collapsed row this long while dragging expands it (about3Pane.js _timedExpand). */
const DRAG_EXPAND_MS = 1000;
const DRAG_TYPE = 'application/x-tt-tree-item';

/** @typedef {'before' | 'after' | 'inside'} DropPosition */

/**
 * @typedef {object} TreeNode
 * @property {string} id unique within the tree
 * @property {string} label accessible text; also used for type-ahead and the default row
 * @property {TreeNode[]} [children]
 * @property {boolean} [expanded] initial state when nothing is persisted
 */

/**
 * ARIA tree after Thunderbird's folder pane (tree-listbox + list-container row states).
 * Light DOM: `<tt-tree role="tree">` > `ul[role=none]` > `li[role=none]` > `div.container[role=treeitem]`
 * + `ul[role=group]`. Selection follows focus, with a roving tabindex.
 *
 * Attributes: `aria-label` (required, localized by the page); `persist` = layout-store key for
 * the expanded ids; `dnd` = rows can be dragged and dropped (see `canDrag`/`canDrop`).
 *
 * Keyboard: Up/Down, Home/End, Right (expand, then first child), Left (collapse, then parent),
 * Enter (activate), printable characters (type-ahead on labels).
 * Pointer: click selects, click on the twisty toggles, double-click activates.
 *
 * Drag and drop (with `dnd`), after Thunderbird's folder pane: the top quarter of a row drops
 * before it, the bottom quarter after it (inside, if it is an expanded parent), the middle inside.
 * Reorders show a line indicator, drops inside the `drop-target` row state; the dragged row is
 * `drag-target`; a collapsed row expands after hovering 1s. Pointer only: the page offers a
 * keyboard alternative (Move To…).
 *
 * Drags from outside the tree (e.g. task rows) carry `externalType`; they drop inside a row only,
 * when `canDropExternal(targetId)` allows it, and fire `tt-drop-external` {targetId}.
 *
 * Events (bubbling): `tt-select` {id}, `tt-toggle` {id, expanded}, `tt-activate` {id},
 * `tt-drop` {id, targetId, position}, `tt-drop-external` {targetId}.
 */
export class TtTree extends HTMLElement {
  /** @type {TreeNode[]} */
  #nodes = [];
  /** @type {Map<string, TreeNode>} */
  #byId = new Map();
  /** @type {Map<string, string | null>} */
  #parentOf = new Map();
  /** @type {Set<string>} */
  #expanded = new Set();
  /** @type {string | null} */
  #selectedId = null;
  #typed = '';
  #typedAt = 0;
  #root = el('ul', { attrs: { role: 'none' } });
  #indicator = el('div', { class: 'drop-indicator', hidden: true });
  #uid = `tt-tree-${crypto.randomUUID()}`;
  /** @type {string | null} */
  #dragId = null;
  /** Last accepted drop location, set by dragover. */
  /** @type {{targetId: string, position: DropPosition} | null} */
  #drop = null;
  /** @type {{id: string, timer: ReturnType<typeof setTimeout>} | null} */
  #expandTimer = null;

  /**
   * Whether a row can be dragged (with `dnd`).
   * @type {(id: string) => boolean}
   */
  canDrag = () => true;

  /**
   * Whether the dragged row `id` may be dropped at `position` of `targetId`.
   * @type {(id: string, targetId: string, position: DropPosition) => boolean}
   */
  canDrop = () => false;

  /**
   * Drag data type accepted from outside the tree (null: none).
   * @type {string | null}
   */
  externalType = null;

  /**
   * Whether the outside drag may be dropped inside `targetId`.
   * @type {(targetId: string) => boolean}
   */
  canDropExternal = () => false;

  /**
   * Fills a row's content (after the twisty). Override to add icons and badges.
   * @type {(node: TreeNode, content: HTMLElement) => void}
   */
  renderRow = (node, content) => {
    content.append(el('span', { class: 'name', text: node.label }));
  };

  connectedCallback() {
    this.setAttribute('role', 'tree');
    if (!this.#root.isConnected) this.append(this.#root, this.#indicator);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('dblclick', this.#onDblClick);
    this.addEventListener('dragstart', this.#onDragStart);
    this.addEventListener('dragover', this.#onDragOver);
    this.addEventListener('dragleave', this.#onDragLeave);
    this.addEventListener('drop', this.#onDrop);
    // On the document: an outside drag ends at its source, not here.
    document.addEventListener('dragend', this.#onDragEnd);
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKeyDown);
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('dblclick', this.#onDblClick);
    this.removeEventListener('dragstart', this.#onDragStart);
    this.removeEventListener('dragover', this.#onDragOver);
    this.removeEventListener('dragleave', this.#onDragLeave);
    this.removeEventListener('drop', this.#onDrop);
    document.removeEventListener('dragend', this.#onDragEnd);
  }

  /**
   * Replaces the tree's data and re-renders, keeping DOM nodes (and focus) for kept ids.
   * @param {TreeNode[]} nodes
   */
  setItems(nodes) {
    const firstLoad = this.#byId.size === 0;
    this.#nodes = nodes;
    this.#byId.clear();
    this.#parentOf.clear();
    /** @param {TreeNode[]} list @param {string | null} parent */
    const index = (list, parent) => {
      for (const node of list) {
        this.#byId.set(node.id, node);
        this.#parentOf.set(node.id, parent);
        if (node.children) index(node.children, node.id);
      }
    };
    index(nodes, null);
    if (firstLoad) {
      const persist = this.getAttribute('persist');
      const stored = persist ? getLayout(persist) : undefined;
      this.#expanded = new Set(
        Array.isArray(stored)
          ? stored.filter((id) => typeof id === 'string')
          : [...this.#byId.values()].filter((n) => n.expanded).map((n) => n.id),
      );
    }
    if (this.#selectedId && !this.#byId.has(this.#selectedId)) this.#selectedId = null;
    // Keep the selection (the Tab stop) visible, e.g. after it moved under a collapsed parent.
    if (this.#selectedId) this.#revealAncestors(this.#selectedId);
    this.#render();
  }

  /** Id of the selected item, or null. Setting it does not fire `tt-select`. */
  get selectedId() {
    return this.#selectedId;
  }

  set selectedId(id) {
    this.#selectedId = id && this.#byId.has(id) ? id : null;
    if (this.#selectedId) this.#revealAncestors(this.#selectedId);
    this.#render();
  }

  /**
   * Id of the item whose row contains `element` (e.g. a contextmenu target), or null.
   * @param {Element | null} element
   */
  itemIdAt(element) {
    const li = /** @type {HTMLElement | null | undefined} */ (
      element?.closest('[role="treeitem"]')?.parentElement
    );
    return li && this.contains(li) ? (li.dataset.id ?? null) : null;
  }

  /** @param {string} id */
  isExpanded(id) {
    return this.#expanded.has(id);
  }

  /** @param {string} id @param {boolean} expanded */
  setExpanded(id, expanded) {
    const node = this.#byId.get(id);
    if (!node?.children?.length || this.#expanded.has(id) === expanded) return;
    if (expanded) this.#expanded.add(id);
    else this.#expanded.delete(id);
    // Collapsing over the selected item moves the selection to the collapsed parent.
    if (!expanded && this.#selectedId && this.#isDescendant(this.#selectedId, id)) {
      this.#select(id);
    }
    const persist = this.getAttribute('persist');
    if (persist) setLayout(persist, [...this.#expanded]);
    this.#render();
    this.dispatchEvent(new CustomEvent('tt-toggle', { bubbles: true, detail: { id, expanded } }));
  }

  /** Moves focus to an item (selecting it). @param {string} id */
  focusItem(id) {
    if (!this.#byId.has(id)) return;
    if (this.#revealAncestors(id)) this.#render();
    this.#select(id);
    this.#itemElement(id)?.focus();
  }

  /** Visible item ids in display order. */
  #visibleIds() {
    /** @type {string[]} */
    const ids = [];
    /** @param {TreeNode[]} list */
    const walk = (list) => {
      for (const node of list) {
        ids.push(node.id);
        if (node.children?.length && this.#expanded.has(node.id)) walk(node.children);
      }
    };
    walk(this.#nodes);
    return ids;
  }

  /** @param {string} id @param {string} ancestor */
  #isDescendant(id, ancestor) {
    for (let p = this.#parentOf.get(id); p; p = this.#parentOf.get(p)) {
      if (p === ancestor) return true;
    }
    return false;
  }

  /** Expands every ancestor of `id`; returns whether anything changed. @param {string} id */
  #revealAncestors(id) {
    let changed = false;
    for (let p = this.#parentOf.get(id); p; p = this.#parentOf.get(p)) {
      if (!this.#expanded.has(p)) changed = true;
      this.#expanded.add(p);
    }
    return changed;
  }

  /** @param {string} id */
  #itemElement(id) {
    return /** @type {HTMLElement | null} */ (
      this.querySelector(`li[data-id="${CSS.escape(id)}"] > [role="treeitem"]`)
    );
  }

  /** @param {string} id */
  #select(id) {
    if (this.#selectedId === id) return;
    this.#selectedId = id;
    // Only the selection changed: update item states without re-rendering rows, so a
    // double-click still lands on the same nodes.
    for (const item of this.querySelectorAll('[role="treeitem"]')) {
      const selected = /** @type {HTMLElement} */ (item.parentElement).dataset.id === id;
      item.setAttribute('aria-selected', String(selected));
      item.setAttribute('tabindex', selected ? '0' : '-1');
    }
    this.dispatchEvent(new CustomEvent('tt-select', { bubbles: true, detail: { id } }));
  }

  #render() {
    const tabbable = this.#selectedId ?? this.#nodes[0]?.id ?? null;
    /** @param {Element} container @param {TreeNode[]} list @param {number} level */
    const renderLevel = (container, list, level) => {
      renderList(
        container,
        list,
        (node) => node.id,
        () => this.#createItem(),
        () => {},
      ).forEach((li, i) => this.#updateItem(li, list[i], level, tabbable));
    };
    renderLevel(this.#root, this.#nodes, 1);
  }

  #createItem() {
    const twisty = el('span', { class: 'twisty' }, icon('nav-down-sm', { class: 'small' }));
    const content = el('span', { class: 'content' });
    // The treeitem is the row only, so its name is the row text (name and badge); the group is
    // a sibling it owns through aria-owns, not a descendant whose text would join the name.
    const container = el(
      'div',
      { class: 'container', attrs: { role: 'treeitem' } },
      twisty,
      content,
    );
    const group = el('ul', { attrs: { role: 'group' } });
    return el('li', { attrs: { role: 'none' } }, container, group);
  }

  /**
   * @param {HTMLElement} li
   * @param {TreeNode} node
   * @param {number} level
   * @param {string | null} tabbable
   */
  #updateItem(li, node, level, tabbable) {
    const hasChildren = Boolean(node.children?.length);
    const expanded = hasChildren && this.#expanded.has(node.id);
    li.dataset.id = node.id;
    li.classList.toggle('children', hasChildren);
    const item = /** @type {HTMLElement} */ (li.firstElementChild);
    const group = /** @type {HTMLElement} */ (li.lastElementChild);
    group.id = `${this.#uid}-${node.id}`;
    setAttrs(item, {
      tabindex: node.id === tabbable ? 0 : -1,
      'aria-level': level,
      'aria-selected': String(node.id === this.#selectedId),
      'aria-expanded': hasChildren ? String(expanded) : null,
      'aria-owns': expanded ? group.id : null,
      draggable: this.hasAttribute('dnd') && this.canDrag(node.id) ? 'true' : null,
    });
    item.style.setProperty('--depth', String(level - 1));
    const content = /** @type {HTMLElement} */ (item.lastElementChild);
    content.replaceChildren();
    this.renderRow(node, content);
    group.hidden = !expanded;
    const renderChildren = expanded ? (node.children ?? []) : [];
    renderList(
      group,
      renderChildren,
      (child) => child.id,
      () => this.#createItem(),
      () => {},
    ).forEach((child, i) => this.#updateItem(child, renderChildren[i], level + 1, tabbable));
  }

  /** @param {Event} event */
  #itemFromEvent(event) {
    const item = /** @type {Element} */ (event.target).closest('[role="treeitem"]');
    const li = /** @type {HTMLElement | null | undefined} */ (item?.parentElement);
    return li && this.contains(li) ? li : null;
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const li = this.#itemFromEvent(event);
    const id = li?.dataset.id;
    if (!id) return;
    if (/** @type {Element} */ (event.target).closest('.twisty')) {
      this.setExpanded(id, !this.#expanded.has(id));
    }
    this.focusItem(id);
  };

  /** @param {MouseEvent} event */
  #onDblClick = (event) => {
    const id = this.#itemFromEvent(event)?.dataset.id;
    if (!id || /** @type {Element} */ (event.target).closest('.twisty')) return;
    this.dispatchEvent(new CustomEvent('tt-activate', { bubbles: true, detail: { id } }));
  };

  /** @param {DragEvent} event */
  #onDragStart = (event) => {
    const li = this.#itemFromEvent(event);
    const id = li?.dataset.id;
    if (!id || !this.hasAttribute('dnd') || !event.dataTransfer) return;
    this.#dragId = id;
    event.dataTransfer.setData(DRAG_TYPE, id);
    event.dataTransfer.effectAllowed = 'move';
    li.classList.add('drag-target');
  };

  /** @param {DragEvent} event */
  #onDragOver = (event) => {
    const li = this.#itemFromEvent(event);
    const targetId = li?.dataset.id;
    if (!li || !targetId) return;
    if (!this.#dragId) {
      this.#onExternalDragOver(event, li, targetId);
      return;
    }
    const row = /** @type {HTMLElement} */ (li.firstElementChild);
    const rect = row.getBoundingClientRect();
    const quarter = rect.height / 4;
    const expandedParent = li.classList.contains('children') && this.#expanded.has(targetId);
    /** @type {DropPosition} */
    let position = 'inside';
    if (event.clientY < rect.top + quarter) position = 'before';
    else if (event.clientY > rect.bottom - quarter && !expandedParent) position = 'after';
    this.#timedExpand(position === 'inside' ? targetId : null);
    if (!this.canDrop(this.#dragId, targetId, position)) {
      this.#clearDropTarget();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.#clearDropTarget();
    this.#drop = { targetId, position };
    if (position === 'inside') {
      li.classList.add('drop-target');
      return;
    }
    const host = this.getBoundingClientRect();
    const content = /** @type {HTMLElement} */ (row.lastElementChild).getBoundingClientRect();
    const rtl = getComputedStyle(this).direction === 'rtl';
    this.#indicator.style.insetBlockStart = `${(position === 'before' ? rect.top : rect.bottom) - host.top}px`;
    this.#indicator.style.insetInlineStart = `${rtl ? host.right - content.right : content.left - host.left}px`;
    this.#indicator.hidden = false;
  };

  /**
   * @param {DragEvent} event
   * @param {HTMLElement} li
   * @param {string} targetId
   */
  #onExternalDragOver(event, li, targetId) {
    const type = this.externalType;
    if (!type || !event.dataTransfer?.types.includes(type)) return;
    this.#timedExpand(targetId);
    if (!this.canDropExternal(targetId)) {
      this.#clearDropTarget();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this.#clearDropTarget();
    this.#drop = { targetId, position: 'inside' };
    li.classList.add('drop-target');
  }

  /** @param {DragEvent} event */
  #onDragLeave = (event) => {
    const to = /** @type {Node | null} */ (event.relatedTarget);
    if (to && this.contains(to)) return;
    this.#clearDropTarget();
    this.#timedExpand(null);
  };

  /** @param {DragEvent} event */
  #onDrop = (event) => {
    const id = this.#dragId;
    const drop = this.#drop;
    this.#clearDropTarget();
    this.#timedExpand(null);
    if (!drop) return;
    event.preventDefault();
    if (!id) {
      const { targetId } = drop;
      this.dispatchEvent(
        new CustomEvent('tt-drop-external', { bubbles: true, detail: { targetId } }),
      );
      return;
    }
    this.dispatchEvent(new CustomEvent('tt-drop', { bubbles: true, detail: { id, ...drop } }));
  };

  #onDragEnd = () => {
    this.#dragId = null;
    this.#clearDropTarget();
    this.#timedExpand(null);
    for (const li of this.querySelectorAll('li.drag-target')) li.classList.remove('drag-target');
  };

  #clearDropTarget() {
    this.#drop = null;
    for (const li of this.querySelectorAll('li.drop-target')) li.classList.remove('drop-target');
    this.#indicator.hidden = true;
  }

  /** Expands `id` after a delay if it is a collapsed parent; null cancels. @param {string | null} id */
  #timedExpand(id) {
    if (this.#expandTimer?.id === id) return;
    if (this.#expandTimer) clearTimeout(this.#expandTimer.timer);
    this.#expandTimer = null;
    if (!id || !this.#byId.get(id)?.children?.length || this.#expanded.has(id)) return;
    this.#expandTimer = {
      id,
      timer: setTimeout(() => {
        this.#expandTimer = null;
        this.setExpanded(id, true);
      }, DRAG_EXPAND_MS),
    };
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Keys typed into controls inside a row (e.g. an inline rename field) are theirs.
    if (/** @type {Element} */ (event.target).getAttribute('role') !== 'treeitem') return;
    const current = this.#itemFromEvent(event)?.dataset.id ?? this.#selectedId;
    if (!current) return;
    const visible = this.#visibleIds();
    const index = visible.indexOf(current);
    const node = this.#byId.get(current);
    const rtl = getComputedStyle(this).direction === 'rtl';
    const key =
      rtl && event.key === 'ArrowLeft'
        ? 'ArrowRight'
        : rtl && event.key === 'ArrowRight'
          ? 'ArrowLeft'
          : event.key;
    /** @type {string | undefined} */
    let target;
    switch (key) {
      case 'ArrowDown':
        target = visible[Math.min(index + 1, visible.length - 1)];
        break;
      case 'ArrowUp':
        target = visible[Math.max(index - 1, 0)];
        break;
      case 'Home':
        target = visible[0];
        break;
      case 'End':
        target = visible[visible.length - 1];
        break;
      case 'ArrowRight':
        if (node?.children?.length) {
          if (!this.#expanded.has(current)) this.setExpanded(current, true);
          else target = node.children[0].id;
        }
        break;
      case 'ArrowLeft':
        if (node?.children?.length && this.#expanded.has(current)) {
          this.setExpanded(current, false);
        } else {
          target = this.#parentOf.get(current) ?? undefined;
        }
        break;
      case 'Enter':
        this.dispatchEvent(
          new CustomEvent('tt-activate', { bubbles: true, detail: { id: current } }),
        );
        break;
      default:
        if (event.key.length === 1 && event.key !== ' ') {
          target = this.#typeAhead(event.key, visible, index);
          if (!target) return;
        } else {
          return;
        }
    }
    event.preventDefault();
    if (target) this.focusItem(target);
  };

  /**
   * Finds the next visible item whose label starts with the typed text. A single character
   * searches from the item after the current one; a longer prefix includes the current one.
   * @param {string} char
   * @param {string[]} visible
   * @param {number} index
   */
  #typeAhead(char, visible, index) {
    const now = performance.now();
    this.#typed = now - this.#typedAt > TYPE_AHEAD_MS ? char : this.#typed + char;
    this.#typedAt = now;
    const prefix = this.#typed.toLocaleLowerCase();
    const start = this.#typed.length === 1 ? index + 1 : index;
    for (let i = 0; i < visible.length; i++) {
      const id = visible[(start + i) % visible.length];
      const label = this.#byId.get(id)?.label.toLocaleLowerCase() ?? '';
      if (label.startsWith(prefix)) return id;
    }
    return undefined;
  }
}

customElements.define('tt-tree', TtTree);
