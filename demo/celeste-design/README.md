# Celeste design canvas (fixture)

A small Marver design folder for Celeste, the demo's sample astrology app. PMA uses it two ways:

- **Built in:** `npm run design:pack` bundles `design/` into `src/lib/marver/fixture.generated.ts`, so
  Settings > Sync screens now works with no GitHub repo (the screen map comes from this manifest).
- **For real:** copy this folder into a repo with `github-template/pma-draft.yml`, connect it in Settings, and
  set `GITHUB_TOKEN`. Drafts then run Marver and Claude Code in GitHub Actions and open pull requests.

Open it locally with `npm install && npx marver dev` (Node 22.18 or newer).
