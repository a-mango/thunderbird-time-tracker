# M7 — Hardening + release

Goal: a 1.0 you would install in your real profile and could submit to ATN.

Read: `docs/PLAN.md` (M7), `.ref/webext-docs/guides/{sourceCodeSubmission,vendoring}.rst`.

## Deliver
1. Accessibility:
   - axe on every page/state
   - keyboard audit (write the table of shortcuts into README)
   - live-region announcements for timer start and stop
   - forced-colors check
   - I will do an Orca pass from your checklist
2. Performance: fixture with 50k entries over 3 years and 300 tasks.
   - Tree badges recompute in under 50 ms after a change (incremental aggregates cached in `meta`, rebuilt on mismatch).
   - Tab cold-open under 300 ms. Paste the numbers.
3. Robustness:
   - DB open failure, blocked upgrade, quota errors become a notification bar with recovery hints
   - corrupt-settings fallback
   - background survives missing permissions
4. FR locale (`_locales/fr`). Keep strings short; Thunderbird's French UI is the tone reference.
5. Packaging:
   - extension icon (16/32/64 SVG/PNG, Thunderbird-style, original artwork)
   - `npm run build` → `dist/*.xpi`
   - `web-ext lint` clean or justified
   - README (install, build from source on a fresh machine with exact Node version), PRIVACY.md, CHANGELOG.md, THIRD_PARTY.md
6. `.github/workflows/release.yml`: on tag `v*`, run check, build, and create a GitHub Release with the XPI attached.
7. ATN checklist in `docs/RELEASE.md`: description, screenshots (from `npm run shots`, fictional data only), permissions justification, no source submission needed (copy-only build).

## Verify
- Install the built XPI in two fresh profiles (157 and the current Release). Run the M3, M5, and M6 manual checklists there and record the results in the PR.
- `spec-reviewer` subagent: the MVP scope in `docs/SPEC.md` is fully met.

## Done when
I've merged the PR, tagged `v1.0.0`, and the release workflow published the XPI.
