import { el, icon } from '../render.js';

/** @type {Record<string, string>} */
const ICONS = { info: 'info', warning: 'warning', error: 'error-circle', success: 'check' };

/**
 * @typedef {object} NotificationAction
 * @property {string} label
 * @property {() => void} onClick
 */

/**
 * Notification bar after Thunderbird's infobar (infobar.css): 4px radius, 16px type icon,
 * message, ghost action buttons and a close button. Place it at the top of the list pane.
 *
 * Attributes: `type` = `info` (default) | `warning` | `error` | `success`; `message`;
 * `persistent` (no close button).
 * Errors use role="alert" (assertive); the others role="status" (polite).
 * Property `actions`: NotificationAction[].
 * Fires `tt-dismiss` when closed; the element is hidden, not removed.
 */
export class TtNotificationBar extends HTMLElement {
  static observedAttributes = ['type', 'message', 'persistent'];

  /** @type {NotificationAction[]} */
  #actions = [];

  connectedCallback() {
    this.#render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#render();
  }

  get actions() {
    return this.#actions;
  }

  set actions(actions) {
    this.#actions = actions;
    if (this.isConnected) this.#render();
  }

  /** Shows the bar again with new content. @param {{type?: string, message: string, actions?: NotificationAction[]}} options */
  show({ type = 'info', message, actions = [] }) {
    this.#actions = actions;
    this.setAttribute('type', type);
    this.setAttribute('message', message);
    this.hidden = false;
  }

  dismiss() {
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('tt-dismiss', { bubbles: true }));
  }

  #render() {
    const type = ICONS[this.getAttribute('type') ?? ''] ? this.getAttribute('type') : 'info';
    this.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const close = this.hasAttribute('persistent')
      ? null
      : el(
          'button',
          {
            class: 'icon-button close',
            type: 'button',
            attrs: { 'aria-label': messenger.i18n.getMessage('notificationClose') },
            on: { click: () => this.dismiss() },
          },
          icon('close'),
        );
    this.replaceChildren(
      el(
        'div',
        { class: 'container' },
        icon(ICONS[type ?? 'info'], { class: 'type-icon' }),
        el('span', { class: 'message', text: this.getAttribute('message') ?? '' }),
        ...this.#actions.map((action) =>
          el('button', {
            class: 'button flat small',
            type: 'button',
            text: action.label,
            on: { click: action.onClick },
          }),
        ),
        close,
      ),
    );
  }
}

customElements.define('tt-notification-bar', TtNotificationBar);
