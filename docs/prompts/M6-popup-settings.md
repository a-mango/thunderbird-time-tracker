# M6 — Popup, settings, data management

Goal: control the timer from any space, configure the extension, and keep data safe.

Read: `docs/DESIGN.md` (Popup, Themes/density/accent), `docs/SPEC.md` (Settings, Privacy).

## Deliver
1. Popup (`ui/popup.html`, 360px):
   - running block (elapsed, task + project, Stop, Split) or "No timer running"
   - "Switch to…" field that fuzzy-searches open tasks; the 5 most recent tasks are listed when the field is empty; Enter starts
   - "Open Time Tracker" opens the space (`spaces.open`)
   - fully keyboard-operable; closes after an action
2. Settings view (from the sidebar More menu, as a dialog or a mode in the tab; pick whichever is closer to Thunderbird and say why):
   - density, accent, week start, daily target
   - show done tasks, confirm deletes
   - duration format (`1h 05m` / `1.08h`)
   - settings apply live to every open page
3. Data:
   - **Backup** writes a versioned JSON of everything (an `<a download>` blob first; fall back to the downloads API only if needed)
   - **Restore** validates with `lib/importer.js`, shows a preview (counts, date range), then replace or merge-by-id
   - **Export CSV** of entries for a date range and project subtree: date, start, end, minutes, project path, task, note, billable
4. Wipe all data (typed confirmation), for testing and privacy.

## Verify
- Unit: round-trip backup → wipe → restore gives a deep-equal DB. CSV is parsed back with a strict parser in the test.
- Playwright: popup start/stop/switch against the mock; settings change density live in another open page; restore preview; axe check on popup and settings.
- Manual: open the CSV in LibreOffice Calc (UTF-8, comma) and attach a screenshot to the PR.

## Done when
PR "M6: popup + settings + data" is open and CI is green.
