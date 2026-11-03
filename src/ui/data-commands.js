// Data management (M6): JSON backup, restore with a preview (merge or replace), CSV export of
// entries and wiping everything. Each command resolves with a message for the caller to show
// (the settings dialog's status line or the notification bar), or null when cancelled.
import { exportBackup, listEntries, restoreBackup, wipeAll } from '../db/index.js';
import { dateInput } from '../lib/entry-form.js';
import { ImportError } from '../lib/errors.js';
import { backupSummary, entriesCsv, exportedEntries, exportFileName } from '../lib/export.js';
import { formatDate } from '../lib/format.js';
import { parseBackup } from '../lib/importer.js';
import { projectPathName } from '../lib/sidebar.js';
import { startOfDay } from '../lib/time.js';
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { el } from './render.js';
import { labelled, uid } from './task-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {{type: 'success' | 'error', text: string}} DataMessage
 */

/** Blob URLs live a minute: long enough for the download to start. */
const REVOKE_MS = 60_000;

/**
 * Saves `text` as a file through an `<a download>` click (no permission needed).
 * @param {string} text
 * @param {string} name
 * @param {string} type
 */
export function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, attrs: { download: name }, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

/**
 * Lets the user pick a file; resolves with null when the picker is cancelled. Call it from a
 * click handler (the picker needs user activation).
 * @param {string} accept
 * @returns {Promise<File | null>}
 */
function pickFile(accept) {
  const input = el('input', { type: 'file', attrs: { accept }, hidden: true });
  document.body.append(input);
  return new Promise((resolve) => {
    const done = (/** @type {File | null} */ file) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/**
 * @param {{data: TrackerData, now?: () => number}} options
 */
export function createDataCommands({ data, now = Date.now }) {
  const locale = messenger.i18n.getUILanguage();

  /** @returns {Promise<DataMessage>} */
  async function backup() {
    const name = exportFileName(now(), 'json');
    const contents = await exportBackup(data.db, { now: now() });
    download(JSON.stringify(contents), name, 'application/json');
    return { type: 'success', text: t('backupDone', name) };
  }

  /**
   * Picks a backup file, validates it, shows the preview and writes it.
   * @returns {Promise<DataMessage | null>}
   */
  async function restore() {
    const file = await pickFile('.json,application/json');
    if (!file) return null;
    /** @type {string} */
    let text;
    try {
      text = await file.text();
    } catch {
      return { type: 'error', text: t('restoreReadError') };
    }
    /** @type {import('../lib/types.js').Backup} */
    let parsed;
    try {
      parsed = parseBackup(text);
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      return { type: 'error', text: t('restoreInvalid', error.message) };
    }
    const mode = await restorePreview(parsed);
    if (!mode) return null;
    try {
      await restoreBackup(data.db, parsed, { mode, now: now() });
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      return { type: 'error', text: t('restoreConflict', error.message) };
    }
    await data.settled();
    return { type: 'success', text: t('restoreDone') };
  }

  /**
   * @param {import('../lib/types.js').Backup} parsed
   * @returns {Promise<'merge' | 'replace' | null>}
   */
  async function restorePreview(parsed) {
    const summary = backupSummary(parsed);
    const date = (/** @type {number} */ ms) => formatDate(ms, { locale });
    const body = el(
      'div',
      { class: 'restore-preview' },
      el('p', {
        class: 'restore-from',
        text: t('restoreSummary', formatDate(summary.exportedAt, { locale, time: true })),
      }),
      el(
        'ul',
        { class: 'delete-counts num' },
        el('li', {
          text: t(
            'restoreCounts',
            String(summary.projects),
            String(summary.tasks),
            String(summary.entries),
          ),
        }),
        el('li', {
          text: summary.range
            ? t('restoreRange', date(summary.range.from), date(summary.range.to))
            : t('restoreNoEntries'),
        }),
      ),
      el('p', { class: 'dialog-hint', text: t('restoreHint') }),
    );
    const answer = await TtDialog.show({
      heading: t('restoreTitle'),
      body,
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        { label: t('restoreReplace'), value: 'replace', destructive: true },
        { label: t('restoreMerge'), value: 'merge', primary: true },
      ],
    });
    return answer === 'merge' || answer === 'replace' ? answer : null;
  }

  /**
   * Asks for a date range and a project, then saves the CSV.
   * @returns {Promise<DataMessage | null>}
   */
  async function exportCsv() {
    const today = now();
    const from = el('input', {
      class: 'field num',
      type: 'date',
      id: uid('tt-export-from'),
      required: true,
      value: dateInput(
        new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1).getTime(),
      ),
    });
    const to = el('input', {
      class: 'field num',
      type: 'date',
      id: uid('tt-export-to'),
      required: true,
      value: dateInput(today),
    });
    const project = el(
      'select',
      { class: 'field', id: uid('tt-export-project') },
      el('option', { value: '', text: t('exportAllProjects') }),
      ...data.projects.map((p) =>
        el('option', { value: p.id, text: projectPathName(data.projects, p.id, ' › ') }),
      ),
    );
    /** Local midnight of a date field, or null. @param {HTMLInputElement} input */
    const day = (input) => (input.value ? new Date(`${input.value}T00:00`).getTime() : null);
    const validate = () => {
      const a = day(from);
      const b = day(to);
      to.setCustomValidity(a !== null && b !== null && b < a ? t('exportBadRange') : '');
    };
    from.addEventListener('input', validate);
    to.addEventListener('input', validate);
    const answer = await TtDialog.show({
      heading: t('exportTitle'),
      body: el(
        'div',
        {},
        el(
          'div',
          { class: 'dialog-row' },
          labelled(t('exportFrom'), from),
          labelled(t('exportTo'), to),
        ),
        labelled(t('exportProject'), project, t('exportHint')),
      ),
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        { label: t('exportButton'), value: 'export', primary: true },
      ],
    });
    const start = day(from);
    const end = day(to);
    if (answer !== 'export' || start === null || end === null) return null;
    const range = { from: start, to: startOfDay(end, 1), projectId: project.value || null };
    const source = {
      projects: data.projects,
      tasks: [...data.tasks.values()],
      entries: await listEntries(data.db),
    };
    const csv = entriesCsv(source, {
      ...range,
      headers: {
        date: t('csvDate'),
        start: t('csvStart'),
        end: t('csvEnd'),
        minutes: t('csvMinutes'),
        project: t('csvProject'),
        task: t('csvTask'),
        note: t('csvNote'),
        billable: t('csvBillable'),
      },
    });
    download(csv, exportFileName(today, 'csv'), 'text/csv;charset=utf-8');
    return {
      type: 'success',
      text: t('exportDone', String(exportedEntries(source, range).length)),
    };
  }

  /**
   * Deletes everything after the user typed the confirmation word.
   * @returns {Promise<DataMessage | null>}
   */
  async function wipe() {
    const word = t('wipeWord');
    const input = el('input', {
      class: 'field',
      id: uid('tt-wipe'),
      required: true,
      autocomplete: 'off',
      attrs: { spellcheck: 'false' },
    });
    const validate = () =>
      input.setCustomValidity(input.value.trim() === word ? '' : t('wipePrompt', word));
    input.addEventListener('input', validate);
    validate();
    const answer = await TtDialog.show({
      heading: t('wipeTitle'),
      body: el('div', {}, el('p', { text: t('wipeText') }), labelled(t('wipePrompt', word), input)),
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        { label: t('wipeButton'), value: 'wipe', primary: true, destructive: true },
      ],
    });
    if (answer !== 'wipe') return null;
    await wipeAll(data.db);
    await data.settled();
    return { type: 'success', text: t('wipeDone') };
  }

  return { backup, restore, exportCsv, wipe };
}
