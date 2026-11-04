# Thunderbird Time Tracker

Thunderbird MV3 extension: projects (folder-like tree) → tasks → time entries, shown in its own space tab that looks like the mail tab.
Plan: `docs/PLAN.md` · Spec: `docs/SPEC.md` · Design: `docs/DESIGN.md` · Milestone briefs: `docs/prompts/`.
Read only the sections the current task needs.

## Commands
- `npm run dev`: serve `src/` with the mock `messenger` and fixtures (http://localhost:5173/)
- `npm run check`: lint + typecheck + unit tests + `web-ext lint` (run before every commit)
- `npm test -- <pattern>`: single unit test file. `npm run test:ui`: Playwright (Firefox) UI tests
- `npm run shots`: screenshots of the dev harness into `artifacts/shots/` (compare with `design/reference/`)
- `npm run tb`: Thunderbird with the isolated dev profile `.tb-profile/`, extension loaded
- `npm run build`: XPI into `dist/` (copy-only zip of `src/`)
- `npm run tb:rc`: fresh profile `.tb-rc/<version>/` with the built XPI installed (`TB_BIN=` for another Thunderbird, `-- --keep` to reuse, `-- --headless`)
- `npm run demo`: fictional demo data dated around today → `artifacts/demo-backup.json`; load it in Thunderbird with Settings… › Data › Restore… (Replace)
- `npm run icon:png`: render `src/icons/time-tracker.svg` to `design/icon/*.png` (ATN listing)
- `npm run tb:spike`: Thunderbird via Marionette on a stage copy (`.tb-stage/`): mail tab vs. gallery metrics, context menus → `artifacts/tb/`
- Primitives gallery: `/dev/gallery.html` (`?density=compact|relaxed`, `?accent=…`); components in `src/ui/components/`, icons via `icon()` in `src/ui/render.js`
<!-- M0: keep this list in sync with package.json -->

## Rules
- `src/` ships as-is: ES modules + JSDoc types, no bundler, no transpiling, **no runtime dependencies**.
- Thunderbird APIs: use `messenger.*`. Check signatures in `.ref/webext-docs/*.rst` (release-mv3, TB 157) before using an API; never from memory.
- Background is a non-persistent event page: no in-memory state, persist to IndexedDB, re-arm alarms on startup.
- All data access goes through `src/db/`. Invariants (one running entry, start<end) live there and have tests.
- UI: tokens from `src/ui/styles/tokens.css` only, no raw colours. Thunderbird SVG icons only (`npm run icons`). No `innerHTML`/`outerHTML`/`insertAdjacentHTML`.
- Every user-visible string goes through `_locales` (`messenger.i18n.getMessage`).
- Durations and times use `tabular-nums`; formatting lives in `src/lib/format.js`.
- IMPORTANT: fixtures, sample data, tests, screenshots and docs use **fictional data only**. Never use real names, organisations, or anything about the maintainer.
- New permission in `manifest.json`: justify it in the PR and update the table in `docs/SPEC.md`.

## Workflow
- One milestone per branch (`mN-slug`) and PR. Small commits. Conventional commit subjects (`feat:`, `fix:`, `test:`…).
- UI work: run `npm run shots`, then use the `ui-reviewer` subagent before saying a UI task is done.
- Before opening a PR: `/check`, then the `spec-reviewer` subagent on the diff.
- Report evidence (command output, screenshot paths), not claims.
- Never touch the real Thunderbird profile (`~/.thunderbird`, Flatpak `~/.var/app/org.mozilla.Thunderbird`). Use `.tb-profile/` only.

## Gotchas
<!-- Add one line per non-obvious lesson learned; prune when obsolete. -->
- `.ref/` holds upstream clones for reading only (gitignored). Refresh with `npm run ref`.
- `.ref/comm-central` is really `thunderbird/thunderbird-desktop` at tag `THUNDERBIRD_157_0_RELEASE` (sparse); the name is kept for stable paths.
- `npm run tb` = `web-ext run` on the real binary (`/usr/lib64/thunderbird/thunderbird`, not the `/usr/bin` wrapper) with `.tb-profile/`; `-- --manual` for about:debugging steps.
- Headless shots resolve `message-box` to fontconfig's `sans-serif` at 14px; Thunderbird uses the GTK font (11pt = 14.67px). Judge font metrics with `npm run tb:spike`.
- Dev URL params: the default seeds only if no database exists; `?seed=N` re-seeds; `?fixtures=empty` wipes; `?fixtures=large` = 50k entries; `?density=`/`?accent=` write settings; `?locale=fr`; `?fail=newer|quota` fakes storage errors; `?idle=N` gives the running entry a pending idle prompt (away N min).
- `page.clock.setFixedTime()` also freezes `performance.now()`: perf tests run on the real clock.
- `scripts/serve.mjs` serves `/src/`; `<html data-dev-ready>` is set after seeding, `data-ready` once the page rendered.
- Playwright `page.clock.pauseAt()` freezes timers too: `clock.resume()` before `expectNoAxeViolations` (axe waits on timers).
- Colour tokens in tests: assert the inline style (`--icon-color: var(--color-accent-teal)`); computed style resolves `var()`.
- Port 5173 may be taken by another app (Playwright then reuses it and every test times out): run `PORT=5199 npm run test:ui`.
- Unit tests run in `TZ=Europe/Zurich` (`vitest.config.js`). db tests use `freshDB()` from `tests/unit/db-helpers.js` (own `IDBFactory`, sets the `IDBKeyRange` global Node lacks).
- `npm test -- --coverage` fails below 90% lines in `src/lib/**` or `src/db/**`.
- A `.tb-profile/` last opened by a newer Thunderbird makes Thunderbird create a new profile in `~/.thunderbird`: `npm run tb`/`tb:spike` refuse it (move it aside). Marionette always listens on 2828 (the pref is ignored), so quit any other Thunderbird with Marionette on before `tb:spike`.
- Claude sandbox: Playwright (`test:ui`, `shots`), `npm run tb`, signed `git commit` and `gh` need to run outside it (`~/.cache`, user namespaces, `~/.gnupg`, gh auth).
