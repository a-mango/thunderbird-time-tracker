# S3 — Timesheet + reports

Goal: answer "what did I do this week and what can I bill?" without leaving Thunderbird.

## Deliver
1. A "Reports" mode in the sidebar: week timesheet grid (rows = tasks grouped by project, columns = days, totals row and column). Editing a cell adds or adjusts a manual entry for that day; ask before replacing existing entries.
2. Filters: date range, project subtree, billable only, tags.
3. Summary: totals per project, billable vs non-billable, optional hourly rate per project (new field, migration).
4. Rounding (5/6/15 min, per entry or per day) is applied **only** in reports and exports, never stored.
5. Export: CSV of the report; printable view (`@media print`), so "Save as PDF" works via print.

## Verify
Unit tests for aggregation with rounding modes; Playwright for grid editing; shots reviewed for Thunderbird style (reuse `tt-table`).
