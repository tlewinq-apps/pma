# PMA draft workflow

PMA sends a `repository_dispatch` (`pma-draft`) to your product repo when an issue needs a design fix. This workflow starts the Marver canvas, screenshots the current frames, runs Claude Code headless to write the proposed frames under `design/` only, screenshots the result, opens a `pma/<id>-<slug>` PR and calls back to PMA. A GitHub webhook then moves the issue through draft ready, in review, shipped or dismissed.

## Install

1. Copy `pma-draft.yml` to `.github/workflows/pma-draft.yml` and `collect-shots.mjs` to `github-template/collect-shots.mjs` in the target repo.
2. Add the repo secret `ANTHROPIC_API_KEY`.
3. Add a repo webhook to `${APP_URL}/api/github/webhook` (content type JSON, secret = `GITHUB_WEBHOOK_SECRET`, events: Pull requests, Pull request reviews).
4. Set `GITHUB_TOKEN` in PMA to a fine-grained PAT with Contents R/W, Pull requests R/W and Actions R/W on that repo (the dispatch call needs Contents write).
5. Make sure `design/.local/` is gitignored (Marver writes screenshots there).
6. Enable "Allow GitHub Actions to create and approve pull requests" (repo Settings > Actions > General > Workflow permissions, or the same setting at org level, which can override the repo). Without it `gh pr create` fails and the draft is reported as failed.
7. Protect the default branch (require a pull request and review before merging). The workflow token has `contents: write`, so branch protection is what keeps an agent-drafted change from reaching the default branch without review.

## How it works

- The dispatch payload is nested under one key, `client_payload.draft`, because GitHub caps `client_payload` at 10 top-level keys. The workflow reads it as `P`.
- Screenshots never travel in the callback body. PMA mints 24 signed upload slots in the `shots` bucket; `collect-shots.mjs` PUTs each PNG to the next slot (max 12 before, 12 after) and the callback only sends `{ frame_id, path }`. PMA accepts only paths for that draft's own slots.
- The callback token is single use (401 invalid, 409 replayed).
- The agent runs in default permission mode with an explicit allowlist: Read/Glob/Grep limited to the checkout (`./**`) plus Write/Edit under `design/scenes/` and `design/boards/` only. Bash, WebFetch, WebSearch, NotebookEdit, Task and Agent are denied, and Read/Glob/Grep carry explicit deny rules for `/proc`, the runner temp dir `/home/runner/work/_temp` (event file, pinned script, baseline) and the home paths `~/.gitconfig`, `~/.ssh/`, `~/.config/`, `~/.npm/`, `~/.claude/` and `~/.docker/`. There is no blanket `~/**` deny because on hosted runners the checkout itself is under `$HOME` and deny rules override allow rules. The prompt is fed on stdin. The agent has only `ANTHROPIC_API_KEY` in its environment, and no callback token (`P` is set only on the steps that need it, never on Marver or the agent). Checkout does not persist credentials.
- The helper script is copied to `$RUNNER_TEMP` before the agent runs. Before the agent, a snapshot records hashes of `.git/config`, `.git/hooks/*`, `~/.gitconfig` and that copy, plus the git status (including ignored files); a single digest of the hashes is published as a step output and is the authority for every later re-check. After the agent, the guard compares the hashes first, then fails if any changed path is outside `design/scenes/` and `design/boards/` (the one exception is `design/manifest.json`, which `marver dev` regenerates whenever frames change; the agent cannot write it). In variant mode the workflow itself renames the target frame to `a-current.tsx` with `git mv` after the before-shots and before the snapshot, because the agent has no Bash and Write/Edit cannot move files. The hashes are checked again at the start of the shots, commit and ready-callback steps (Marver is stopped after the after-shots); every git command after the agent runs with hooks disabled.
- Only `design/scenes/` and `design/boards/` may be written by the agent, and `design/.local/` (Marver's screenshots and scratch space) must be gitignored. Each draft gets its own branch (`pma/<id>-<slug>-<draft id prefix>`).
- On any failure or cancellation a `failed` callback sends the Actions run URL and the issue returns to `new`.
- Customer quotes go into the prompt as untrusted data, and the agent cannot run commands.

## Security model and residual risk

- The agent can only read the checkout and write `design/scenes/` and `design/boards/`. Anything else it changes fails the guard. Reads are allowlisted to `./**`; as a backstop, Read, Glob and Grep are explicitly denied on `/proc`, `/home/runner/work/_temp` and `~/.gitconfig`, `~/.ssh/`, `~/.config/`, `~/.npm/`, `~/.claude/`, `~/.docker/` (not all of `~`, which contains the checkout).
- It has no shell or web tools (Bash, WebFetch, WebSearch, NotebookEdit, Task and Agent are denied).
- Secrets stay off the agent and Marver steps: the callback token and signed upload URLs (`P`) and the GitHub token are set only on the steps that need them. The agent holds only `ANTHROPIC_API_KEY`; use a spend-limited key.
- Integrity re-checks (a digest of `.git/config`, `.git/hooks/*`, `~/.gitconfig` and the pinned helper script, taken before the agent runs) gate every privileged step: after-shots, commit and PR, and both callbacks. Marver is stopped once the after-shots are done, even if an earlier step failed.
- Review every PMA PR before merging: frame files are code.
- Residual risk: if Marver ever executes scene modules in Node (rather than only in the browser), a malicious scene written by a prompt-injected agent could tamper with the environment of later steps in the same job (for example files outside the hashed set). The full fix is to split the work into an unprivileged render job (agent, Marver, screenshots, no secrets beyond the API key) and a separate privileged job that receives only the design diff as an artifact and does the commit, PR and callback.
