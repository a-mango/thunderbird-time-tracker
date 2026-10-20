# M0 — Bootstrap + spikes

Goal: an empty but fully wired project. Every later milestone can verify itself without me.

Read: `CLAUDE.md`, `docs/PLAN.md` (Decisions, M0), `docs/SPEC.md` (Platform, Architecture, Permissions).

## Deliver
1. `npm init` with devDependencies only: typescript, eslint (flat config) + prettier, vitest + @vitest/coverage-v8 + fake-indexeddb, @playwright/test + @axe-core/playwright, web-ext. Pin exact versions. `engines.node >= 20`.
2. Scripts exactly as listed in `CLAUDE.md`, plus:
   - `typecheck`, `lint`, `lint:ext`
   - `icons` (stub for M1)
   - `ref` (clone/update `.ref/`, see 3)
3. `scripts/ref.sh` clones into `.ref/` (gitignored, shallow):
   - `mozilla/releases-comm-central`, sparse to `mail/themes/shared/mail/` and `mail/components/extensions/schemas/`
   - `thunderbird/webext-docs`, branch `esr-mv3`
   - `thunderbird/sample-extensions`
4. `tsconfig.json`: `allowJs`, `checkJs`, `strict`, `noEmit`, `module`/`target` ES2022, `lib` DOM.
   - Typings spike: is there a maintained npm package for Thunderbird's `messenger` API that covers MV3/ESR 153? If not, generate or write `src/types/messenger.d.ts` from `.ref/.../schemas/*.json`, limited to the APIs we use (spaces, action, runtime, storage, alarms, commands, menus, i18n, tabs). Record the choice in `docs/PLAN.md`.
5. `src/manifest.json` (MV3):
   - gecko id `time-tracker@example.invalid`, with a TODO for me to set my own
   - `strict_min_version` 128.0
   - background `scripts` + `type: module`
   - `action` with `allowed_spaces: []`, `default_locale: en`
   - `commands` for `toggle-timer` and `_execute_action`
   - permissions: only what M0 uses
6. `src/background/main.js`: on install/startup, make sure the `time_tracker` space exists (query, then create) and opens `ui/tracker.html`. Use the spaces API exactly as documented in `.ref/webext-docs/spaces.rst`.
7. Placeholder `src/ui/tracker.html` (+ `.js`, `.css` linking `design/tokens.css` copied to `src/ui/styles/`), placeholder `src/ui/popup.html`, `src/_locales/en/messages.json`.
8. Dev harness:
   - `scripts/serve.mjs` (Node built-ins only) serves `src/` at :5173 and injects `<script type=module src=/dev/mock-messenger.js>` into served HTML. Shipped files never reference `dev/`.
   - `dev/mock-messenger.js` is an in-memory `messenger`/`browser` covering the APIs above.
   - `dev/fixtures.js` is a seeded generator of fictional projects/tasks/entries. Reuse the names from `design/reference/*.html`; never real ones.
9. Tests:
   - `tests/unit/smoke.test.js`
   - `tests/ui/smoke.spec.js`: Playwright Firefox loads the dev tab and runs an axe check
   - `scripts/shots.mjs` writes `artifacts/shots/*.png`
10. Spike — `npm run tb`. Find the most automated reliable way to start Thunderbird with an isolated profile in `.tb-profile/` and the unpacked extension loaded. Try in order:
    - (a) `web-ext run` pointed at the Thunderbird binary
    - (b) a profile `extensions/<id>` proxy file plus `user.js` prefs
    - (c) a script that opens Thunderbird on the profile and prints the manual steps for `about:debugging` → Load Temporary Add-on

    Detect RPM vs Flatpak. Keep the winner and record it in `CLAUDE.md` Gotchas.
11. `.gitignore`: `node_modules/`, `.ref/`, `.tb-profile/`, `artifacts/`, `dist/`, `coverage/`.
12. Check that `.github/workflows/ci.yml` matches the scripts, and adjust if needed.
13. GitHub: create labels (`milestone`, `stretch`, `spike`, `bug`) and one issue per milestone and stretch item, with the bullets and ✅ criteria from `docs/PLAN.md`. **Ask me before running `gh` writes.**

## Verify
- `npm run check` is green.
- `npm run test:ui` is green.
- `npm run shots` produces a PNG; read it.
- `npm run tb` works, or prints exact manual steps if only (c) is possible.
- Push the branch and confirm CI is green with `gh run watch`.

## Done when
The PR "M0: bootstrap" is open with CI green. Its body lists the spike outcomes and any changes to `CLAUDE.md` commands.
