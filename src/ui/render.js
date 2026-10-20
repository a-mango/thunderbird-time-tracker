// Small DOM helpers shared by the tt-* elements and pages. Nodes are built with
// createElement/textContent or cloned from <template> elements, never parsed from strings.

const SVG_NS = 'http://www.w3.org/2000/svg';
// Resolved at runtime against this module (a variable base keeps Vite's asset rewrite out of tests).
const MODULE_URL = import.meta.url;

/**
 * @typedef {object} ElementProps
 * @property {string} [class] space-separated class names
 * @property {string} [text] textContent
 * @property {Record<string, string | number | boolean | null | undefined>} [attrs]
 *   attributes; `true` sets an empty attribute, `false`/`null`/`undefined` leaves it unset
 * @property {Record<string, string>} [dataset]
 * @property {Record<string, string>} [style] properties set with style.setProperty (custom properties too)
 * @property {Record<string, EventListener>} [on] event listeners
 */

/**
 * Creates an element. Keys outside ElementProps are assigned as DOM properties (type, value, hidden…).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {ElementProps & Record<string, unknown>} [props]
 * @param {...(Node | string | null | undefined | false)} children strings become text nodes
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { class: className, text, attrs, dataset, style, on, ...rest } = props;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  setAttrs(node, attrs);
  if (dataset) Object.assign(node.dataset, dataset);
  for (const [name, value] of Object.entries(style ?? {})) node.style.setProperty(name, value);
  for (const [type, listener] of Object.entries(on ?? {})) node.addEventListener(type, listener);
  Object.assign(node, rest);
  append(node, children);
  return node;
}

/**
 * Sets or removes attributes: `true` → empty attribute, `false`/`null`/`undefined` → removed.
 * @param {Element} node
 * @param {Record<string, string | number | boolean | null | undefined>} [attrs]
 */
export function setAttrs(node, attrs = {}) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) node.removeAttribute(name);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

/**
 * @param {Node} parent
 * @param {(Node | string | null | undefined | false)[]} children
 */
function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * Clones a <template> and collects its `[data-ref]` elements by name.
 * @param {HTMLTemplateElement | string} template the element or its id
 * @returns {{fragment: DocumentFragment, refs: Record<string, HTMLElement>}}
 */
export function cloneTemplate(template) {
  const source =
    typeof template === 'string'
      ? document.getElementById(template)
      : /** @type {Element} */ (template);
  if (!(source instanceof HTMLTemplateElement))
    throw new Error(`No <template> ${String(template)}`);
  const fragment = /** @type {DocumentFragment} */ (source.content.cloneNode(true));
  /** @type {Record<string, HTMLElement>} */
  const refs = {};
  for (const node of fragment.querySelectorAll('[data-ref]')) {
    refs[/** @type {HTMLElement} */ (node).dataset.ref ?? ''] = /** @type {HTMLElement} */ (node);
  }
  return { fragment, refs };
}

/**
 * A Thunderbird icon from src/ui/icons/ (see ICONS.txt), drawn with <use> so it inherits
 * `color` (outline) and `--icon-fill-opacity` (tint, default 0.2).
 * @param {string} name file name without .svg
 * @param {{label?: string, class?: string}} [options] `label` makes it an image with that name;
 *   without it the icon is decorative (aria-hidden)
 * @returns {SVGSVGElement}
 */
export function icon(name, { label, class: className } = {}) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('class', className ? `icon ${className}` : 'icon');
  svg.dataset.icon = name;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', new URL(`icons/${name}.svg#i`, MODULE_URL).href);
  use.setAttribute('width', '100%');
  use.setAttribute('height', '100%');
  svg.appendChild(use);
  return svg;
}

/** @type {WeakMap<Element, Map<unknown, Element>>} */
const keyedNodes = new WeakMap();

/**
 * Keyed list rendering: makes `container`'s children one node per item, in item order.
 * Nodes are reused by key (so focus and scroll state survive), created with `create` for new keys,
 * refreshed with `update` for kept keys, and removed for missing keys.
 * The container must hold only nodes rendered by this function.
 * @template T
 * @template {Element} N
 * @param {Element} container
 * @param {readonly T[]} items
 * @param {(item: T) => unknown} keyOf
 * @param {(item: T) => N} create
 * @param {(node: N, item: T) => void} [update]
 * @returns {N[]} the nodes, in order
 */
export function renderList(container, items, keyOf, create, update) {
  const previous = keyedNodes.get(container) ?? new Map();
  /** @type {Map<unknown, Element>} */
  const next = new Map();
  /** @type {N[]} */
  const nodes = [];
  for (const item of items) {
    const key = keyOf(item);
    if (next.has(key)) throw new Error(`renderList: duplicate key ${String(key)}`);
    let node = /** @type {N | undefined} */ (previous.get(key));
    if (node) update?.(node, item);
    else node = create(item);
    next.set(key, node);
    nodes.push(node);
  }
  for (const [key, node] of previous) if (!next.has(key)) node.remove();
  nodes.forEach((node, index) => {
    const current = container.children[index];
    if (current !== node) container.insertBefore(node, current ?? null);
  });
  keyedNodes.set(container, next);
  return nodes;
}
