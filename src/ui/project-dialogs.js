// Project dialogs (tt-dialog): create/edit, Move To… and delete confirmation. They only collect
// the user's answer; ui/project-commands.js writes it through db/.
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { el } from './render.js';
import { DEFAULT_PROJECT_COLOR } from '../db/projects.js';
import { LIMITS } from '../lib/limits.js';
import { PALETTE, colorValue, paletteColor } from '../lib/palette.js';
import { moveTargets } from '../lib/sidebar.js';

/**
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {{name: string, color: string, parentId: string | null}} ProjectInput
 */

/** Indent for nested options: native <select> options can't be padded. */
const INDENT = ' ';

/** @param {string} prefix */
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;

/**
 * A <select> of parents: top level, then every project `id` can move under, indented by depth.
 * @param {Project[]} projects
 * @param {string | null} id the project being edited or moved (its subtree is left out)
 * @param {string | null} selected
 */
function parentSelect(projects, id, selected) {
  const select = el('select', { class: 'field', id: uid('tt-parent'), name: 'parent' });
  select.append(el('option', { value: '', text: t('projectTopLevel') }));
  for (const target of moveTargets(projects, id)) {
    select.append(
      el('option', { value: target.id, text: `${INDENT.repeat(target.depth + 1)}${target.label}` }),
    );
  }
  select.value = selected ?? '';
  return select;
}

/**
 * Colour swatches as a native radio group (arrow keys move and choose). A stored colour outside
 * the palette (from an import) is offered first so editing keeps it.
 * @param {string} current
 */
function colorChoices(current) {
  const name = uid('tt-color');
  const fieldset = el(
    'fieldset',
    { class: 'swatches' },
    el('legend', { class: 'dialog-label', text: t('projectColor') }),
  );
  const colors = paletteColor(current)
    ? PALETTE.map((p) => ({ color: p.color, label: t(p.label) }))
    : [
        { color: current, label: current },
        ...PALETTE.map((p) => ({ color: p.color, label: t(p.label) })),
      ];
  for (const { color, label } of colors) {
    fieldset.append(
      el('input', {
        type: 'radio',
        class: 'swatch',
        name,
        value: color,
        checked: color.toLowerCase() === current.toLowerCase(),
        title: label,
        attrs: { 'aria-label': label },
        style: { '--swatch-color': colorValue(color) },
      }),
    );
  }
  return fieldset;
}

/** @param {string} labelText @param {HTMLElement} field */
function labelled(labelText, field) {
  return el(
    'div',
    { class: 'dialog-field' },
    el('label', { class: 'dialog-label', text: labelText, htmlFor: field.id }),
    field,
  );
}

/**
 * Create or edit a project. Projects inside the Archive keep their parent (no parent choice).
 * @param {Project[]} projects
 * @param {{project?: Project, parentId?: string | null, archived?: boolean}} options
 *   `project` edits it; otherwise creates one under `parentId`. `archived`: it is in the Archive.
 * @returns {Promise<ProjectInput | null>}
 */
export async function projectDialog(projects, { project, parentId = null, archived = false }) {
  const name = el('input', {
    class: 'field',
    id: uid('tt-name'),
    type: 'text',
    required: true,
    maxLength: LIMITS.name,
    value: project?.name ?? '',
    autocomplete: 'off',
  });
  // Whitespace-only names are rejected by db/ too; say so before the dialog closes.
  name.addEventListener('input', () => {
    name.setCustomValidity(name.value.trim() ? '' : t('projectNameRequired'));
  });
  const colors = colorChoices(project?.color ?? DEFAULT_PROJECT_COLOR);
  const parent = parentSelect(projects, project?.id ?? null, project ? project.parentId : parentId);
  const body = el(
    'div',
    { class: 'project-form' },
    labelled(t('projectName'), name),
    colors,
    archived ? null : labelled(t(project ? 'projectParentEdit' : 'projectParent'), parent),
  );
  const value = await TtDialog.show({
    heading: t(project ? 'projectDialogEdit' : 'projectDialogNew'),
    body,
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t(project ? 'dialogSave' : 'projectCreate'), value: 'ok', primary: true },
    ],
  });
  if (value !== 'ok') return null;
  const checked = /** @type {HTMLInputElement | null} */ (colors.querySelector(':checked'));
  return {
    name: name.value.trim(),
    color: checked?.value ?? DEFAULT_PROJECT_COLOR,
    parentId: archived ? (project?.parentId ?? null) : parent.value || null,
  };
}

/**
 * Asks where to move `project` (Move To…, the keyboard alternative to drag and drop).
 * @param {Project[]} projects
 * @param {Project} project
 * @returns {Promise<{parentId: string | null} | null>} null when cancelled
 */
export async function moveDialog(projects, project) {
  const parent = parentSelect(projects, project.id, project.parentId);
  const value = await TtDialog.show({
    heading: t('moveDialogTitle'),
    body: labelled(t('moveDialogText', project.name), parent),
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('moveButton'), value: 'ok', primary: true },
    ],
  });
  return value === 'ok' ? { parentId: parent.value || null } : null;
}

/**
 * Confirms deleting `project`. With `counts` (what a cascade removes), lists them and warns that
 * everything goes; without, a plain confirmation.
 * @param {Project} project
 * @param {{projects: number, tasks: number, entries: number} | null} counts
 */
export async function confirmDelete(project, counts) {
  const body = counts
    ? el(
        'div',
        {},
        el('p', { text: t('deleteCascade', project.name) }),
        el(
          'ul',
          { class: 'delete-counts num' },
          el('li', { text: t('deleteCountProjects', String(counts.projects)) }),
          el('li', { text: t('deleteCountTasks', String(counts.tasks)) }),
          el('li', { text: t('deleteCountEntries', String(counts.entries)) }),
        ),
        el('p', { text: t('deleteCascadeNote') }),
      )
    : t('deleteConfirm', project.name);
  const value = await TtDialog.show({
    heading: t('deleteDialogTitle'),
    body,
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('deleteButton'), value: 'delete', primary: true, destructive: true },
    ],
  });
  return value === 'delete';
}
