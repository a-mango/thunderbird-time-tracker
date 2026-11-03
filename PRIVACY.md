# Privacy

Time Tracker keeps everything on your computer.

- **No network access.** The add-on sends nothing anywhere: no telemetry, no analytics, no
  crash reports, no remote code, no update checks of its own (Thunderbird updates add-ons). The
  manifest declares `data_collection_permissions: none`.
- **Where your data lives.** Projects, tasks, time entries and settings are stored in
  Thunderbird's IndexedDB storage for this add-on, inside your Thunderbird profile. Removing the
  add-on removes them.
- **Files you save.** A backup (JSON) or a CSV export is written only when you ask for one,
  through Thunderbird's normal save dialog or download folder. Restoring reads only the file you
  choose.
- **Your mail.** Version 1.0 doesn't read your messages, accounts or contacts.

## Permissions

| Permission | Why |
|---|---|
| `alarms` | Refresh the running time on the toolbar button once a minute |
| `menus`, `menus.overrideContext` | Native context menus on rows in the Time Tracker tab only |
| `notifications` | Tell you how to start a task when `Alt+Shift+K` has nothing to start |

No host permissions, no access to websites.

Questions: <https://github.com/a-mango/thunderbird-time-tracker/issues>
