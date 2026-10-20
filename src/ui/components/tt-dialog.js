import { el } from '../render.js';

/**
 * @typedef {object} DialogButton
 * @property {string} label
 * @property {string} value returned by open() when this button closes the dialog
 * @property {boolean} [primary] the default action; placed last, like Thunderbird
 * @property {boolean} [destructive]
 */

/**
 * @typedef {object} DialogOptions
 * @property {string} heading
 * @property {Node | string} [body]
 * @property {DialogButton[]} [buttons] default: Cancel + OK (primary)
 */

/**
 * Modal dialog wrapping a native `<dialog>`, styled like Thunderbird's in-content dialogs
 * (inContentDialog.css): title, body, buttons right-aligned with the primary last.
 *
 * Usage: `const value = await TtDialog.show({heading, body, buttons})`, or put a `<tt-dialog>`
 * in the page, set `heading`/`buttons`, append body content to it and call `open()`.
 * Children of the element become the dialog body.
 *
 * Keyboard: Tab stays inside (native modal), Escape cancels (resolves null), Enter in a field
 * submits the primary button. Focus goes to the first field (or the primary button) on open
 * and back to the previously focused element on close.
 */
export class TtDialog extends HTMLElement {
  heading = '';
  /** @type {DialogButton[]} */
  buttons = [];
  #dialog = el('dialog', { class: 'tt-dialog' });
  /** @type {((value: string | null) => void) | null} */
  #resolve = null;
  /** @type {HTMLElement | null} */
  #returnFocus = null;

  /**
   * Builds a temporary dialog, opens it and removes it after it closes.
   * @param {DialogOptions} options
   * @returns {Promise<string | null>} the button value, or null when cancelled
   */
  static async show({ heading, body, buttons }) {
    const dialog = /** @type {TtDialog} */ (document.createElement('tt-dialog'));
    dialog.heading = heading;
    if (buttons) dialog.buttons = buttons;
    if (body) dialog.append(typeof body === 'string' ? el('p', { text: body }) : body);
    document.body.append(dialog);
    try {
      return await dialog.open();
    } finally {
      dialog.remove();
    }
  }

  /** The native dialog element (for tests and advanced use). */
  get dialog() {
    return this.#dialog;
  }

  /**
   * Shows the dialog modally.
   * @returns {Promise<string | null>}
   */
  open() {
    if (this.#dialog.open) this.close(null);
    this.#build();
    this.#returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    this.#dialog.showModal();
    const first = /** @type {HTMLElement | null} */ (
      this.#dialog.querySelector('.dialog-body :is(input, select, textarea)') ??
        this.#dialog.querySelector('button.primary') ??
        this.#dialog.querySelector('button')
    );
    first?.focus();
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** @param {string | null} value */
  close(value) {
    if (!this.#dialog.open) return;
    this.#dialog.close();
    this.#finish(value);
  }

  #build() {
    const titleId = `tt-dialog-title-${crypto.randomUUID()}`;
    const buttons = this.buttons.length
      ? this.buttons
      : [
          { label: messenger.i18n.getMessage('dialogCancel'), value: 'cancel' },
          { label: messenger.i18n.getMessage('dialogOk'), value: 'ok', primary: true },
        ];
    const ordered = [...buttons.filter((b) => !b.primary), ...buttons.filter((b) => b.primary)];
    const body = el('div', { class: 'dialog-body' }, ...this.childNodes);
    const form = el(
      'form',
      { attrs: { method: 'dialog' } },
      el('h2', { class: 'dialog-title', id: titleId, text: this.heading }),
      body,
      el(
        'div',
        { class: 'dialog-buttons' },
        ...ordered.map((b) =>
          el('button', {
            class: `button${b.primary ? ' primary' : ''}${b.destructive ? ' destructive' : ''}`,
            type: b.primary ? 'submit' : 'button',
            value: b.value,
            text: b.label,
            on: { click: (event) => this.#onButton(event, b.value) },
          }),
        ),
      ),
    );
    this.#dialog.setAttribute('aria-labelledby', titleId);
    this.#dialog.replaceChildren(form);
    this.#dialog.onclose = () => this.#finish(this.#dialog.returnValue || null);
    this.#dialog.oncancel = () => {
      this.#dialog.returnValue = '';
    };
    this.replaceChildren(this.#dialog);
  }

  /** @param {Event} event @param {string} value */
  #onButton(event, value) {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (this.#dialog.querySelector('form'));
    if (/** @type {HTMLButtonElement} */ (event.currentTarget).type === 'submit') {
      if (!form.reportValidity()) return;
    }
    this.close(value);
  }

  /** @param {string | null} value */
  #finish(value) {
    const resolve = this.#resolve;
    this.#resolve = null;
    if (!resolve) return;
    // Children return to the element so a reopened dialog keeps its body.
    const body = this.#dialog.querySelector('.dialog-body');
    if (body) this.append(...body.childNodes);
    this.#dialog.remove();
    this.#returnFocus?.focus();
    resolve(value === 'cancel' ? null : value);
  }
}

customElements.define('tt-dialog', TtDialog);
