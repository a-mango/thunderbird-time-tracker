// Data management (M6): JSON backup, restore with a preview (merge or replace), CSV export of
// entries, import from Super Productivity (S7) and wiping everything. Each command resolves with a message for the caller to show
// (the settings dialog's status line or the notification bar), or null when cancelled.
import {
  exportBackup,
  importBatch,
  listEntries,
  previewBatch,
  restoreBackup,
  wipeAll,
} from '../db/index.js';
import { dateInput } from '../lib/entry-form.js';
import { ImportError, InvariantError, ValidationError } from '../lib/errors.js';
import { backupSummary, entriesCsv, exportedEntries, exportFileName } from '../lib/export.js';
import { formatDate } from '../lib/format.js';
import { MAX_IMPORT_BYTES, parseBackup } from '../lib/importer.js';
import { projectPathName } from '../lib/sidebar.js';
import { MAX_SP_BYTES, parseSuperProductivity } from '../lib/sp-import.js';
import { startOfDay } from '../lib/time.js';
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { clearLayout } from './layout-store.js';
import { el } from './render.js';
import { labelled, uid } from './task-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {{type: 'success' | 'error', text: string}} DataMessage
 */

/** Localised reason per ImportError code; anything else is a format mismatch. */
/** @type {Record<string, string>} */
const IMPORT_REASONS = {
  'too-large': 'restoreReasonTooLarge',
  json: 'restoreReasonJson',
  format: 'restoreReasonFormat',
  version: 'restoreReasonVersion',
  running: 'restoreReasonRunning',
  'multiple-running': 'restoreReasonMultipleRunning',
};

/**
 * The user-facing reason of a rejected backup; the code and location go to the console.
 * @param {ImportError} error
 */
function importReason(error) {
  console.warn('time tracker: backup rejected', error.code, error.details.path);
  return t(IMPORT_REASONS[error.code] ?? 'restoreReasonContents');
}

/** Localised reason per ImportError code of a Super Productivity file. */
/** @type {Record<string, string>} */
const SP_REASONS = {
  'too-large': 'spImportReasonTooLarge',
  json: 'restoreReasonJson',
  'time-tracker-backup': 'spImportReasonOwn',
};

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
    // Refuse before reading a huge file into memory (parseBackup checks the text again).
    if (file.size > MAX_IMPORT_BYTES) {
      return { type: 'error', text: t('restoreInvalid', t('restoreReasonTooLarge')) };
    }
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
      return { type: 'error', text: t('restoreInvalid', importReason(error)) };
    }
    const mode = await restorePreview(parsed);
    if (!mode) return null;
    try {
      await restoreBackup(data.db, parsed, { mode, now: now() });
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      return { type: 'error', text: t('restoreConflict', importReason(error)) };
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
        class: 'restore-from num',
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
    // Layout values hold project ids and typed filter text.
    clearLayout();
    await data.settled();
    return { type: 'success', text: t('wipeDone') };
  }

  /**
   * Picks a Super Productivity backup, shows what it adds and imports it (S7).
   * @returns {Promise<DataMessage | null>}
   */
  async function importSuperProductivity() {
    const file = await pickFile('.json,application/json');
    if (!file) return null;
    /** @param {string} reason */
    const invalid = (reason) => ({
      type: /** @type {const} */ ('error'),
      text: t('spImportInvalid', t(reason)),
    });
    if (file.size > MAX_SP_BYTES) return invalid('spImportReasonTooLarge');
    /** @type {string} */
    let text;
    try {
      text = await file.text();
    } catch {
      return { type: 'error', text: t('restoreReadError') };
    }
    /** @type {ReturnType<typeof parseSuperProductivity>} */
    let parsed;
    try {
      parsed = parseSuperProductivity(text, {
        untitled: t('spImportUntitled'),
        inbox: t('spImportInbox'),
      });
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      console.warn('time tracker: Super Productivity file rejected', error.code);
      return invalid(SP_REASONS[error.code] ?? 'spImportReasonFormat');
    }
    const plan = await previewBatch(data.db, parsed.batch, { now: now() });
    if (!(await importPreview(parsed, plan))) return null;
    /** @type {import('../lib/import-batch.js').ImportPlan} */
    let added;
    try {
      added = await importBatch(data.db, parsed.batch, { now: now() });
    } catch (error) {
      // A record the repositories would refuse: the transaction wrote nothing.
      if (!(error instanceof ValidationError || error instanceof InvariantError)) throw error;
      console.warn('time tracker: Super Productivity import refused', error.code, error.message);
      return { type: 'error', text: t('spImportFailed') };
    }
    await data.settled();
    return {
      type: 'success',
      text: t(
        'spImportDone',
        String(added.projects.length),
        String(added.tasks.length),
        String(added.entries.length),
      ),
    };
  }

  /**
   * What the import adds, what is already here and what can't be read; resolves true to import.
   * Counts sit in a table (To add / Already here), so no message needs a plural form.
   * @param {ReturnType<typeof parseSuperProductivity>} parsed
   * @param {import('../lib/import-batch.js').ImportPlan} plan
   */
  async function importPreview({ summary, skipped }, plan) {
    const date = (/** @type {number} */ ms) => formatDate(ms, { locale });
    const fresh = plan.projects.length + plan.tasks.length + plan.entries.length > 0;
    const empty = summary.folders + summary.projects + summary.tasks + summary.entries === 0;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    // By start: a block ending at midnight belongs to its own day.
    for (const entry of plan.entries) {
      from = Math.min(from, entry.start);
      to = Math.max(to, entry.start);
    }
    const unread = skipped + plan.dropped;
    /** @param {string} label @param {number} added @param {number} here */
    const row = (label, added, here) =>
      el(
        'tr',
        {},
        el('th', { attrs: { scope: 'row' }, text: t(label) }),
        el('td', { text: String(added) }),
        el('td', { text: String(here) }),
      );
    const table = el(
      'table',
      { class: 'import-counts num' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('td', {}),
          el('th', { attrs: { scope: 'col' }, text: t('spImportColNew') }),
          el('th', { attrs: { scope: 'col' }, text: t('spImportColExisting') }),
        ),
      ),
      el(
        'tbody',
        {},
        row('spImportRowProjects', plan.projects.length, plan.reused.projects),
        row('spImportRowTasks', plan.tasks.length, plan.reused.tasks),
        row('spImportRowEntries', plan.entries.length, plan.skipped),
      ),
    );
    const notes = [
      plan.entries.length > 0 ? t('restoreRange', date(from), date(to)) : null,
      plan.changed > 0 ? t('spImportChanged', String(plan.changed)) : null,
      unread > 0 ? t('spImportSkipped', String(unread)) : null,
    ].filter((text) => text !== null);
    const body = el(
      'div',
      { class: 'restore-preview' },
      el('p', {
        class: 'restore-from num',
        text:
          summary.exportedAt === null
            ? t('spImportNoDate')
            : t('spImportSummary', formatDate(summary.exportedAt, { locale, time: true })),
      }),
      empty ? null : table,
      notes.length > 0
        ? el('ul', { class: 'delete-counts num' }, ...notes.map((text) => el('li', { text })))
        : null,
      fresh
        ? el('p', { class: 'dialog-hint', text: t('spImportHint') })
        : el('p', {
            text: t(
              empty ? 'spImportEmpty' : plan.changed > 0 ? 'spImportNothingNew' : 'spImportNothing',
            ),
          }),
    );
    const answer = await TtDialog.show({
      heading: t('spImportTitle'),
      body,
      buttons: fresh
        ? [
            { label: t('dialogCancel'), value: 'cancel' },
            { label: t('spImportButton'), value: 'import', primary: true },
          ]
        : [{ label: t('dialogClose'), value: 'cancel', primary: true }],
    });
    return answer === 'import';
  }

  return { backup, restore, importSuperProductivity, exportCsv, wipe };
}
