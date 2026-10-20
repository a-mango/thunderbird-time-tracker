import { getLayout, setLayout } from '../layout-store.js';
import { el, icon, renderList } from '../render.js';

const TYPE_AHEAD_MS = 500;

/**
 * @typedef {object} TreeNode
 * @property {string} id unique within the tree
 * @property {string} label accessible text; also used for type-ahead and the default row
 * @property {TreeNode[]} [children]
 * @property {boolean} [expanded] initial state when nothing is persisted
 */

/**
 * ARIA tree after Thunderbird's folder pane (tree-listbox + list-container row states).
 * Light DOM: `<tt-tree role="tree">` > `ul[role=none]` > `li[role=treeitem]` > `div.container`
 * + `ul[role=group]`. Selection follows focus, with a roving tabindex.
 *
 * Attributes: `aria-label` (required, localized by the page); `persist` = layout-store key for
 * the expanded ids.
 *
 * Keyboard: Up/Down, Home/End, Right (expand, then first child), Left (collapse, then parent),
 * Enter (activate), printable characters (type-ahead on labels).
 * Pointer: click selects, click on the twisty toggles, double-click activates.
 *
 * Events (bubbling): `tt-select` {id}, `tt-toggle` {id, expanded}, `tt-activate` {id}.
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

  /**
   * Fills a row's content (after the twisty). Override to add icons and badges.
   * @type {(node: TreeNode, content: HTMLElement) => void}
   */
  renderRow = (node, content) => {
    content.append(el('span', { class: 'name', text: node.label }));
  };

  connectedCallback() {
    this.setAttribute('role', 'tree');
    if (!this.#root.isConnected) this.append(this.#root);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('dblclick', this.#onDblClick);
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKeyDown);
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('dblclick', this.#onDblClick);
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
    this.#revealAncestors(id);
    if (this.#selectedId === id) this.#render();
    else this.#select(id);
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

  /** @param {string} id */
  #revealAncestors(id) {
    for (let p = this.#parentOf.get(id); p; p = this.#parentOf.get(p)) this.#expanded.add(p);
  }

  /** @param {string} id */
  #itemElement(id) {
    return /** @type {HTMLElement | null} */ (
      this.querySelector(`li[data-id="${CSS.escape(id)}"]`)
    );
  }

  /** @param {string} id */
  #select(id) {
    if (this.#selectedId === id) return;
    this.#selectedId = id;
    this.#render();
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
    const container = el('div', { class: 'container' }, twisty, content);
    const group = el('ul', { attrs: { role: 'group' } });
    return el('li', { attrs: { role: 'treeitem' } }, container, group);
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
    li.tabIndex = node.id === tabbable ? 0 : -1;
    li.setAttribute('aria-level', String(level));
    li.setAttribute('aria-selected', String(node.id === this.#selectedId));
    li.setAttribute('aria-label', node.label);
    if (hasChildren) li.setAttribute('aria-expanded', String(expanded));
    else li.removeAttribute('aria-expanded');
    li.classList.toggle('children', hasChildren);
    const container = /** @type {HTMLElement} */ (li.firstElementChild);
    container.style.setProperty('--depth', String(level - 1));
    const content = /** @type {HTMLElement} */ (container.lastElementChild);
    content.replaceChildren();
    this.renderRow(node, content);
    const group = /** @type {HTMLElement} */ (li.lastElementChild);
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
    const li = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest('li[role="treeitem"]')
    );
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

  /** @param {KeyboardEvent} event */
  #onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
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
