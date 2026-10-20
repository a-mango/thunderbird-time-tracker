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
- Dev harness URLs: `?fixtures=empty` (no data), `?fixtures=none` (no background), `?seed=N`.
- Claude sandbox: Playwright (`test:ui`, `shots`), `npm run tb`, signed `git commit` and `gh` need to run outside it (`~/.cache`, user namespaces, `~/.gnupg`, gh auth).
