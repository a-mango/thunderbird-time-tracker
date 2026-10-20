import { getLayout, setLayout } from '../layout-store.js';

const STEP = 10;
const BIG_STEP = 50;

/**
 * Pane splitter after Thunderbird's pane-splitter: a 1px line with a 5px hit area that resizes
 * the pane it controls by pointer drag or keyboard.
 *
 * Attributes:
 * - `controls` (required): id of the pane to resize; its inline-size (or block-size) is set in px.
 * - `resize`: `width` (default) or `height`.
 * - `pane`: `before` (default; the pane precedes the splitter) or `after`.
 * - `min`, `max`: size limits in px (default 100 and 2000).
 * - `persist`: layout-store key; the size is restored on connect and saved after each change.
 * - `aria-label`: the accessible name, e.g. "Resize the project pane" (localized by the page).
 *
 * Keyboard (role="separator"): arrows ±10px (Shift ±50px), Home = min, End = max.
 * Fires `tt-resize` with `detail: {size}` after each change.
 */
export class TtSplitter extends HTMLElement {
  /** @type {{start: number, size: number, id: number} | null} */
  #drag = null;

  connectedCallback() {
    this.setAttribute('role', 'separator');
    this.tabIndex = 0;
    this.setAttribute('aria-orientation', this.#vertical ? 'horizontal' : 'vertical');
    const pane = this.#pane;
    if (pane) this.setAttribute('aria-controls', pane.id);
    this.setAttribute('aria-valuemin', String(this.#min));
    this.setAttribute('aria-valuemax', String(this.#max));
    const persist = this.getAttribute('persist');
    const stored = persist ? getLayout(persist) : undefined;
    if (typeof stored === 'number') this.size = stored;
    else this.#updateValue(this.size);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('pointerdown', this.#onPointerDown);
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKeyDown);
    this.removeEventListener('pointerdown', this.#onPointerDown);
  }

  /** Current size of the controlled pane in px. */
  get size() {
    const rect = this.#pane?.getBoundingClientRect();
    return Math.round((this.#vertical ? rect?.height : rect?.width) ?? 0);
  }

  /** Sets the controlled pane's size, clamped to min/max. */
  set size(value) {
    const pane = this.#pane;
    if (!pane) return;
    const size = Math.round(Math.min(this.#max, Math.max(this.#min, value)));
    pane.style.setProperty(this.#vertical ? 'block-size' : 'inline-size', `${size}px`);
    this.#updateValue(size);
  }

  get #vertical() {
    return this.getAttribute('resize') === 'height';
  }

  get #pane() {
    const id = this.getAttribute('controls');
    return id ? /** @type {HTMLElement | null} */ (this.ownerDocument.getElementById(id)) : null;
  }

  get #min() {
    return Number(this.getAttribute('min') ?? 100);
  }

  get #max() {
    return Number(this.getAttribute('max') ?? 2000);
  }

  /** +1 when moving right/down grows the pane. */
  get #direction() {
    const after = this.getAttribute('pane') === 'after';
    const rtl = !this.#vertical && getComputedStyle(this).direction === 'rtl';
    return (after ? -1 : 1) * (rtl ? -1 : 1);
  }

  /** @param {number} size */
  #updateValue(size) {
    this.setAttribute('aria-valuenow', String(size));
  }

  /** @param {number} size */
  #commit(size) {
    this.size = size;
    const persist = this.getAttribute('persist');
    if (persist) setLayout(persist, this.size);
    this.dispatchEvent(
      new CustomEvent('tt-resize', { bubbles: true, detail: { size: this.size } }),
    );
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown = (event) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const [less, more] = this.#vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    /** @type {number | undefined} */
    let size;
    if (event.key === less) size = this.size - step * this.#direction;
    else if (event.key === more) size = this.size + step * this.#direction;
    else if (event.key === 'Home') size = this.#min;
    else if (event.key === 'End') size = this.#max;
    if (size === undefined) return;
    event.preventDefault();
    this.#commit(size);
  };

  /** @param {PointerEvent} event */
  #onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.focus();
    this.setPointerCapture(event.pointerId);
    this.#drag = {
      start: this.#vertical ? event.clientY : event.clientX,
      size: this.size,
      id: event.pointerId,
    };
    this.classList.add('resizing');
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerUp);
    this.addEventListener('pointercancel', this.#onPointerUp);
  };

  /** @param {PointerEvent} event */
  #onPointerMove = (event) => {
    if (!this.#drag || event.pointerId !== this.#drag.id) return;
    const position = this.#vertical ? event.clientY : event.clientX;
    this.size = this.#drag.size + (position - this.#drag.start) * this.#direction;
  };

  /** @param {PointerEvent} event */
  #onPointerUp = (event) => {
    if (!this.#drag || event.pointerId !== this.#drag.id) return;
    this.#drag = null;
    this.classList.remove('resizing');
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerUp);
    this.removeEventListener('pointercancel', this.#onPointerUp);
    this.#commit(this.size);
  };
}

customElements.define('tt-splitter', TtSplitter);
