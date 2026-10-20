# S5 — Integrations / sync (decide first)

Goal: get entries out of Thunderbird without breaking the local-only default.

Start in plan mode and **don't write code yet**. Research and compare these for my use case:
- (a) Push to a time-tracking service: Kimai, Clockify, Toggl, or Jira worklogs
- (b) Sync a JSON file over WebDAV, e.g. Nextcloud
- (c) Export only, which we already have

For each option cover: the required host permission (scope it to one user-entered origin), auth model and where the secret is stored (`storage.local`, not synced), conflict handling, and what leaves the machine.

Recommend one. I'll pick, and the chosen option then gets its own spec section and brief.

Constraints:
- Opt-in, off by default, with a clear indicator when on.
- `optional_host_permissions`, requested at enable time.
- No credentials in logs or exports.
- Every network call goes through one audited module.
