# 00 — One-time setup (you, ~15 min)

## Machine (Fedora)
```bash
sudo dnf install -y nodejs npm git gh jq thunderbird   # Node ≥ 20; Fedora ships 22
gh auth login
npm install -g @anthropic-ai/claude-code               # or your usual install method
```
If you run Thunderbird from Flatpak instead of RPM, M0 adapts `npm run tb`.

## Repository
```bash
gh repo clone a-mango/thunderbird-time-tracker
cd thunderbird-time-tracker
# copy the contents of this kit (including hidden .claude/ and .github/) into the repo root
git add -A && git commit -m "chore: project kit (plan, spec, design, Claude Code config)"
git push -u origin main
```
The `ci` run on this first commit fails because there's no `package.json` yet. That's expected; M0 fixes it.
Once M0's PR is green: Settings → Branches → protect `main` (require a PR and the `ci` check).

## Claude Code
```bash
claude            # first run in the repo: accept the workspace trust prompt so .claude/settings.json applies
/permissions      # check that the allow/ask/deny rules from .claude/settings.json are loaded
/context          # check that CLAUDE.md is loaded
```
Optional:
- `/install-github-app`: lets you use `@claude` in issues and PRs and adds PR review. Pick the subscription token if you don't want API billing.
- `/plugin`: add a TypeScript code-intelligence plugin (helps JSDoc-typed JS).
- `/sandbox`: OS-level sandboxing for Bash (needs `bubblewrap`; `sudo dnf install bubblewrap socat`).

## Then
```
/rename m0-bootstrap
/milestone M0
```
