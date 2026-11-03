// Settings dialog (More › Settings…). A modal in-content dialog like Thunderbird's preference
// subdialogs; every control saves on change (no OK button, like Thunderbird's settings), so the
// page behind it, and every other open page, updates at once. The Data section runs the backup,
// restore, CSV export and wipe commands and shows their result in a status line.
import { updateSettings } from '../db/index.js';
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { el } from './render.js';
import { uid } from './task-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Settings} Settings
 * @typedef {ReturnType<typeof import('./data-commands.js').createDataCommands>} DataCommands
 * @typedef {import('./data-commands.js').DataMessage} DataMessage
 */

const DENSITIES = /** @type {const} */ (['compact', 'default', 'relaxed']);
const ACCENTS = /** @type {const} */ ([
  'system',
  'thunderbird',
  'purple',
  'orange',
  'pink',
  'ink',
  'teal',
]);

/** @param {string} word */
const capitalized = (word) => word[0].toUpperCase() + word.slice(1);

/**
 * @param {string} labelText
 * @param {HTMLElement} control
 */
function row(labelText, control) {
  return el(
    'div',
    { class: 'settings-row' },
    el('label', { text: labelText, htmlFor: control.id }),
    control,
  );
}

/**
 * @param {[value: string, label: string][]} options
 * @param {string} value
 */
function select(options, value) {
  const node = el(
    'select',
    { class: 'field', id: uid('tt-setting') },
    ...options.map(([v, label]) => el('option', { value: v, text: label })),
  );
  node.value = value;
  return node;
}

/** @param {string} labelText @param {boolean} checked */
function checkbox(labelText, checked) {
  const input = el('input', { type: 'checkbox', id: uid('tt-setting'), checked });
  return {
    input,
    node: el(
      'div',
      { class: 'dialog-check' },
      input,
      el('label', { text: labelText, htmlFor: input.id }),
    ),
  };
}

/** @param {string} heading @param {...(Node | null)} children */
const section = (heading, ...children) =>
  el(
    'fieldset',
    { class: 'settings-section' },
    el('legend', { class: 'settings-heading', text: heading }),
    ...children,
  );

/**
 * Opens the settings dialog and resolves when it is closed.
 * @param {{data: TrackerData, commands: DataCommands, onError: (error: unknown) => void}} options
 */
export async function settingsDialog({ data, commands, onError }) {
  const settings = data.settings;
  /** @param {Partial<Settings>} patch */
  const save = (patch) => updateSettings(data.db, patch).catch(onError);

  const density = select(
    DENSITIES.map((d) => [d, t(`settingsDensity${capitalized(d)}`)]),
    settings.density,
  );
  density.addEventListener('change', () =>
    save({ density: /** @type {Settings['density']} */ (density.value) }),
  );
  const accent = select(
    ACCENTS.map((a) => [a, t(`settingsAccent${capitalized(a)}`)]),
    settings.accent,
  );
  accent.addEventListener('change', () =>
    save({ accent: /** @type {Settings['accent']} */ (accent.value) }),
  );

  const weekStart = select(
    [
      ['1', t('settingsWeekMonday')],
      ['0', t('settingsWeekSunday')],
    ],
    String(settings.weekStart),
  );
  weekStart.addEventListener('change', () =>
    save({ weekStart: /** @type {0 | 1} */ (Number(weekStart.value)) }),
  );
  const target = el('input', {
    class: 'field num',
    type: 'number',
    id: uid('tt-setting'),
    min: '0',
    max: '24',
    step: '0.25',
    required: true,
    value: String(settings.dailyTargetMin / 60),
  });
  target.addEventListener('change', () => {
    const hours = target.valueAsNumber;
    const valid = target.checkValidity() && Number.isFinite(hours);
    target.setAttribute('aria-invalid', String(!valid));
    // An invalid value isn't saved: say why instead of dropping it silently.
    if (!valid) target.reportValidity();
    else save({ dailyTargetMin: Math.round(hours * 60) });
  });
  const durationFormat = select(
    [
      ['hm', t('settingsDurationHm')],
      ['decimal', t('settingsDurationDecimal')],
    ],
    settings.durationFormat,
  );
  durationFormat.addEventListener('change', () =>
    save({ durationFormat: /** @type {Settings['durationFormat']} */ (durationFormat.value) }),
  );

  const showDone = checkbox(t('settingsShowDone'), settings.showDone);
  showDone.input.addEventListener('change', () => save({ showDone: showDone.input.checked }));
  const confirmDelete = checkbox(t('settingsConfirmDelete'), settings.confirmDelete);
  confirmDelete.input.addEventListener('change', () =>
    save({ confirmDelete: confirmDelete.input.checked }),
  );

  const status = el('p', { class: 'settings-status', attrs: { role: 'status' } });
  /** @param {() => Promise<DataMessage | null>} command */
  const run = async (command) => {
    status.textContent = '';
    try {
      const message = await command();
      if (!message) return;
      status.textContent = message.text;
      status.classList.toggle('error', message.type === 'error');
    } catch (error) {
      onError(error);
    }
  };
  /** @param {string} label @param {() => Promise<DataMessage | null>} command */
  const dataButton = (label, command, destructive = false) =>
    el('button', {
      class: `button${destructive ? ' destructive' : ''}`,
      type: 'button',
      text: label,
      on: { click: () => run(command) },
    });

  const body = el(
    'div',
    { class: 'settings' },
    section(
      t('settingsAppearance'),
      row(t('settingsDensity'), density),
      row(t('settingsAccent'), accent),
    ),
    section(
      t('settingsTime'),
      row(t('settingsWeekStart'), weekStart),
      row(t('settingsDailyTarget'), target),
      row(t('settingsDurationFormat'), durationFormat),
    ),
    section(t('settingsLists'), showDone.node, confirmDelete.node),
    section(
      t('settingsData'),
      el('p', { class: 'dialog-hint', text: t('settingsDataHint') }),
      el(
        'div',
        { class: 'settings-buttons' },
        dataButton(t('settingsBackup'), commands.backup),
        dataButton(t('settingsRestore'), commands.restore),
        dataButton(t('settingsExportCsv'), commands.exportCsv),
        dataButton(t('settingsWipe'), commands.wipe, true),
      ),
      status,
    ),
  );

  // A restore or wipe from here changes the settings too: show the stored values.
  const sync = () => {
    const current = data.settings;
    density.value = current.density;
    accent.value = current.accent;
    weekStart.value = String(current.weekStart);
    if (document.activeElement !== target) target.value = String(current.dailyTargetMin / 60);
    durationFormat.value = current.durationFormat;
    showDone.input.checked = current.showDone;
    confirmDelete.input.checked = current.confirmDelete;
  };
  data.addEventListener('change', sync);
  try {
    await TtDialog.show({
      heading: t('settingsTitle'),
      body,
      buttons: [{ label: t('settingsClose'), value: 'close', primary: true }],
    });
  } finally {
    data.removeEventListener('change', sync);
  }
}
