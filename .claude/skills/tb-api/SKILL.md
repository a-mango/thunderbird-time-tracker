---
name: tb-api
description: How to use Thunderbird WebExtension APIs correctly in this project. Use whenever writing or changing code that calls messenger.* or editing manifest.json.
paths: ["src/background/**", "src/manifest.json", "src/ui/**", "dev/mock-messenger.js"]
---

- The source of truth is `.ref/webext-docs/<api>.rst` (branch `release-mv3`, our target: Thunderbird 157) and the schemas in `.ref/comm-central/mail/components/extensions/schemas/`. Grep them before using any function, parameter, event, or manifest key. Don't rely on Firefox/Chrome docs or memory; Thunderbird differs (e.g. `spaces`, `action.setLabel`, `allowed_spaces`, MV3 renames in `guides/manifestV3.rst`).
- Working examples: `.ref/sample-extensions/manifest_v3/`.
- Namespace: `messenger.*`. Background is an event page (`background.scripts`, `type: module`). Register listeners synchronously at top level; keep no state in memory.
- Every API you call must also exist in `dev/mock-messenger.js` with the same signature and semantics. Update the mock in the same commit.
- New permission? Add it to `manifest.json`, the permissions table in `docs/SPEC.md`, and the PR description with a justification. Prefer `optional_permissions` for stretch features.
