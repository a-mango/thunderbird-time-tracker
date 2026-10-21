# Plan

## Decisions

| Topic | Choice | Why |
|---|---|---|
| Extension format | Thunderbird MV3, event-page background | MV3 is the supported direction; the event page can suspend, so state lives in the DB |
| Language | JS ES modules + JSDoc types, `tsc --noEmit` (strict, `checkJs`) | Typed, but copy-only shipping, so no ATN source submission |
| UI | Vanilla custom elements, no framework, zero runtime deps | Matches Thunderbird's own front-end; smallest review and attack surface |
| Storage | IndexedDB (own thin wrapper) | Relational-ish data, indexes, transactions |
| Tests | Vitest + fake-indexeddb (logic); Playwright Firefox + axe (UI, against a mock `messenger`) | Claude Code can verify on its own without Thunderbird |
| In-TB testing | Isolated dev profile in `.tb-profile/` (gitignored) | Never touches the real mail profile |
| Design | `docs/DESIGN.md`, `design/tokens.css`, `design/reference/*` | Values taken from Thunderbird's source |
| Target | Thunderbird 157 Release, `strict_min_version` 157.0; docs `release-mv3`, source tag `THUNDERBIRD_157_0_RELEASE` | Decided in M0 (was ESR 153 / min 128): code against the docs we actually read, test on the installed version |
| `messenger` typings | Local `src/types/messenger.d.ts`, hand-written from `.ref/webext-docs` | `@types/thunderbird-webext-browser` last released 127.0.0 (Jul 2024, TB 127.0a1): no MV3/157 coverage. Not shipped (excluded from the XPI) |
| TypeScript | 7.0.2 (native port) | Verified in M0 that `checkJs` catches JSDoc `@typedef`/`@type`/`import()` errors; fall back to 6.0.3 if that regresses |
| Run in Thunderbird | `npm run tb` = `web-ext run --firefox <real TB binary> --firefox-profile .tb-profile --keep-profile-changes` | M0 spike option (a) works on TB 157 RPM: temporary add-on, auto-reload, `-no-remote` so a running real instance is never reused. `--manual` prints the about:debugging steps (option c) |
| Dev data in M0 | Pages ask the background via `runtime.sendMessage({type:'tt:summary'})`; the mock answers from `dev/fixtures.js` | No permission or dev import in shipped code; M2 swaps the background handler for `db/` |
| Running timer (M2) | `meta.running` holds the running entry's id, read and written in the same readwrite transaction as every write that starts, stops or removes it | IndexedDB can't index `null`, so `end === null` is invisible to the `end` index. Spike: fake-indexeddb queues readwrite transactions across two connections like browsers do, so the two-context test is meaningful |
| Entry delete (M2) | Soft delete (`deletedAt`), undo until the next Thunderbird start; `runtime.onStartup` purges | Maintainer's choice; not at event-page top level, which runs on every wake-up |
| `storage` permission (M2) | Deferred: settings live in IndexedDB `meta.settings` | One source of truth, no new permission until a `storage.local` mirror is needed |
| Field limits (M2) | `src/lib/limits.js` shared by `db/validate.js` and `lib/importer.js` | Anything the repositories store re-imports; `tests/unit/db-backup.test.js` guards it |
| Notifications (M2) | Per-connection notifier (`openDB({notify})`), called after `oncomplete` only; failures are logged, never fail the write | Testable without globals; aborted writes never announce changes |
| Tokens | `src/ui/styles/tokens.css` takes Thunderbird 157 values; `design/tokens.css` (160.0a1) stays as a historical copy | Target release; divergences (incl. WCAG AA fixes) listed in `docs/DESIGN.md` |
| Icons | Imported SVGs drawn with `<svg><use href="icons/x.svg#i">` (`icon()` in `ui/render.js`) | `<img>` can't inherit `currentColor`; `<use>` keeps the two-tone fill and works in moz-extension pages (M1 spike) |
| Components | Light-DOM custom elements (`tt-tree`, `tt-table`, `tt-splitter`, `tt-dialog`, `tt-notification-bar`) styled by `components.css` | Global tokens apply without shadow-DOM duplication, like Thunderbird's own `tree-listbox` |
| Layout persistence | `ui/layout-store.js` over `localStorage`, swappable with `setLayoutStore()` | pane and column sizes are per-window UI state (`storage` was deferred in M2) |
| DOM unit tests | `jsdom` 30.1.2 (dev only) via `// @vitest-environment jsdom` | Render helper and layout store need a DOM; Node env stays the default |
| In-TB measurements | `npm run tb:spike`: stage copy + `web-ext run --marionette -remote-allow-system-access`, chrome-scope scripts | Reproducible spike evidence without hand steps; nothing changes in `src/` or the shipped manifest |

## How each milestone runs (Claude Code on your machine)

1. Fresh session: `claude`, then `/rename mN-slug`, then `/milestone MN`. The skill reads the brief in `docs/prompts/`, the GitHub issue, and the relevant spec/design sections.
2. **Plan mode first**. Claude explores and returns a plan. You review it (`Ctrl+G` opens it in your editor), then approve.
3. Implement on branch `mN-slug` in small commits, writing tests alongside.
4. Verify: `/check` (lint, types, unit, `web-ext lint`). For UI milestones also run `npm run test:ui` and `npm run shots`, then the `ui-reviewer` subagent compares the shots with `design/reference/`.
5. The `spec-reviewer` subagent checks the diff against this file's acceptance criteria. Fix correctness gaps only.
6. Push the branch and open a PR with `Closes #N` and evidence (check output, screenshot paths). CI must be green. You test in Thunderbird (`npm run tb`), then squash-merge.
7. `/clear` before the next milestone. If you've corrected Claude twice on the same thing, `/clear` and restart with a sharper prompt.

## GitHub

- Repo: `a-mango/thunderbird-time-tracker` (public). Everything committed is world-readable, so fixtures and screenshots stay fictional, and the dev profile, `.ref/`, and secrets stay gitignored.
- `main` is protected: PR required, CI (`.github/workflows/ci.yml`) required.
- Labels: `milestone`, `stretch`, `spike`, `bug`. M0 creates one issue per milestone and stretch item from this file (Claude asks before running `gh issue create`).
- Bugs you find while testing in Thunderbird go in as issues (template: `.github/ISSUE_TEMPLATE/bug.md`). Fix them locally with `/issue N`.
- Optional: run `/install-github-app` once. You can then comment `@claude …` on small issues and PRs, and add the code-review workflow so every PR gets a fresh-context review. A subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) works instead of an API key.
- Release (M7): pushing tag `vX.Y.Z` runs a workflow that builds the XPI and attaches it to a GitHub Release.

## Milestones

**M0 Bootstrap + spikes**
- Repo layout, package scripts (see `CLAUDE.md`), tsconfig, eslint/prettier, vitest, playwright (firefox), web-ext.
- `.ref/` clones: comm-central (sparse: themes, icons, extension schemas), webext-docs `release-mv3`, sample-extensions.
- Minimal MV3 manifest: a space that opens a placeholder `ui/tracker.html`; an action with a placeholder popup; `_locales/en`.
- Dev harness: `scripts/serve.mjs` serves `src/` and injects `dev/mock-messenger.js` and fixtures (fictional data).
- Spike: the most automated reliable way to run the add-on in `.tb-profile/` (`npm run tb`).
- Spike: typings for `messenger.*` (community package if current, else a minimal local `.d.ts`).
- ✅ `npm run check` is green locally and in CI.
- ✅ `npm run tb` shows the space button, and clicking it opens the placeholder tab.
- ✅ `npm run dev` shows the tab in a browser with mock data.
- ✅ Issues and labels exist.

**M1 Design system + primitives**
- Diff `design/tokens.css` against `.ref` for the targeted release (157), then copy it into `src/ui/styles/`. Add `base.css` and icon import.
- Primitives: buttons, icon buttons, fields, badges, pills, `tt-splitter`, `tt-tree` (ARIA tree), `tt-table` (ARIA grid: sort, column picker), dialog helper, notification bar.
- `dev/gallery.html` shows every primitive, light/dark × 3 densities.
- Spikes inside Thunderbird: `font: message-box` size, `AccentColor`, and `menus.overrideContext` in our page.
- ✅ Gallery shots reviewed against the references.
- ✅ axe reports 0 violations.
- ✅ Tree and table keyboard tests pass.
- ✅ Spike results are recorded in `docs/DESIGN.md`.

**M2 Data layer**
- `db/` wrapper, schema v1, migrations, repositories, invariants, change propagation.
- `lib/` time math, rollups, formatting, CSV, JSON import validation.
- Tests cover DST in Europe/Zurich, midnight-crossing entries, week start, deep rollups, the single-running-timer invariant across two contexts, hostile imports, and migrations.
- ✅ ≥90% line coverage on `lib/` and `db/`.
- ✅ Every invariant has a test.

**M3 Shell + project tree**
- Three-pane layout with persisted splitters.
- Sidebar header; Views and Projects modes.
- Project create/edit/archive/delete dialogs.
- Drag-and-drop reorder/reparent, plus a keyboard "Move to…".
- Live rollup badges; native context menus (if the spike succeeded).
- ✅ UI tests cover CRUD, reparenting, and keyboard navigation.
- ✅ Sidebar shots match the reference.

**M4 Task list**
- Table view: columns, sort, and column picker (persisted); quick filter pills plus a text filter.
- Show/hide done tasks; star; inline start/stop.
- New task flow and task edit dialog (estimate, billable, tags, notes, move).
- ✅ UI tests pass.
- ✅ The list renders 2,000 tasks in under 100 ms.
- ✅ Shots match the reference.

**M5 Timer + detail pane + background**
- Timer operations (start, stop, switch, split, discard, adjust start).
- Detail pane: breadcrumb, timer box, stats, entries grouped by day.
- Entry dialog with an overlap warning; delete with undo.
- Background: 1-minute alarm, action label and badge, space badge, `Alt+Shift+T` command.
- ✅ Unit tests for every timer operation.
- ✅ Manual check in Thunderbird: the timer survives a restart, badges update, and the command works.

**M6 Popup + settings + data**
- Popup: running timer, switch-to search, recent tasks.
- Settings: density, accent, week start, target, done tasks, confirmations.
- JSON backup/restore; CSV export.
- ✅ export → wipe → import round-trips with identical data.
- ✅ The CSV opens cleanly in LibreOffice.

**M7 Hardening + release**
- a11y pass (axe + Orca).
- Performance with 50k entries: badges recompute in under 50 ms (incremental aggregates).
- FR locale; DB error and upgrade handling; clean `web-ext lint`.
- README, PRIVACY.md, CHANGELOG, extension icon, release workflow, ATN checklist.
- ✅ The RC XPI passes the manual checklist on a clean 157 profile and a clean current-Release profile.

## Stretch (after M7)

S1 Mail linking · S2 Idle detection · S3 Timesheet and reports · S4 Day timeline + Cards view (design B) · S5 Integrations/sync. Each has a brief in `docs/prompts/`.

## Known risks (resolved by spikes)

- Auto-loading an unpacked add-on into Thunderbird (fallback: manual `about:debugging` → Load Temporary Add-on).
- System font size and accent in extension pages vs. Thunderbird chrome.
- Native context menus in an extension tab (`menus.overrideContext`).
- Badge refresh cadence: alarms fire at most once a minute, so the label shows `h:mm`, not seconds.
- Playwright Firefox on Fedora (no `install-deps`; install missing libraries with dnf if the browser fails to launch).

### M0 spike outcomes
- **`npm run tb`**: option (a) `web-ext run` works with the RPM binary `/usr/lib64/thunderbird/thunderbird` (157.0); the space button appears and opens the tab. Flatpak is detected (`flatpak:org.mozilla.Thunderbird`) but untested here. Option (b) (proxy file) was not needed.
- **Typings**: no maintained package for MV3/157, see Decisions. `data_collection_permissions: {required: ["none"]}` is declared so `web-ext lint` is clean.
- **TODO (owner)**: replace the gecko id `time-tracker@example.invalid` in `src/manifest.json` with your own before the first signed or ATN build.

### M1 spike outcomes
Details and numbers: `docs/DESIGN.md` → M1 spike outcomes (measured on Thunderbird 158.0, the installed RPM).
- `font: message-box`, `AccentColor`, folder/thread row heights and mode header size match the mail tab exactly (after making tree rows content-box).
- Thunderbird's font-size, accent and density prefs don't reach extension pages (`UIFontSize` skips them; `-moz-pref()` never matches), so density and accent stay our own settings.
- `menus.overrideContext()` works in our tab → M3 uses native context menus and adds `menus`, `menus.overrideContext`.
