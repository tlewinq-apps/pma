# Self-hosting PMA

The [README](../README.md) runs PMA on your laptop against a dev Supabase project. This page puts a copy online for a team: Supabase (Free) for the database, Vercel (Hobby) for the app, and a GitHub App for Build it. Slack is optional, and Sentry needs no server setup at all.

Keep production values in `.env.prod.local` (every `.env*` file except `.env.example` is gitignored). Set `PMA_PROD_SUPABASE_REF` to the production project's ref in both `.env.local` and `.env.prod.local`: the maintenance scripts then refuse to touch production unless you add `PMA_ALLOW_PROD=1`.

## 1. A production Supabase project

1. Create a project at [supabase.com](https://supabase.com). Note the database password.
2. Create the schema:
   ```bash
   npx supabase link --project-ref <production ref>
   npx supabase db push
   ```
3. In the dashboard, under Authentication:
   - **URL Configuration**: set Site URL to your app's address (`https://<your-app>.vercel.app`) and add `https://<your-app>.vercel.app/**` to Redirect URLs.
   - **Sign In / Providers > GitHub**: turn it on with a GitHub OAuth App (github.com/settings/developers) whose callback URL is `<your Supabase URL>/auth/v1/callback`. Use a separate OAuth App from your dev one.

   `npm run supabase:config-push` only ever writes to the dev project, so production's auth settings live in the dashboard.

## 2. The app on Vercel

1. Import the repository in Vercel. `vercel.json` declares Next.js, so there is nothing to pick.
2. Add these Production environment variables:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | From Project Settings > API Keys > Legacy API keys |
   | `APP_URL` | `https://<your-app>.vercel.app` |
   | `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |
   | `DRAFT_BACKEND` | `mock` |
   | `PMA_PROD_SUPABASE_REF` | The production project's ref |

   Leave `ANTHROPIC_API_KEY` empty. Every company adds its own Claude key in PMA, and a key here could be spent by anyone who signs in.
3. Deploy, open the site and sign in with GitHub. A new account lands on **Set up your company**, and **Start here** walks through the rest.

## 3. Background work

New feedback is processed by `/api/cron/process`. Vercel Hobby allows only daily crons (the two in `vercel.json`), so the database calls the route every 5 minutes instead, through pg_cron:

```bash
node --env-file=.env.prod.local --import tsx scripts/cron-setup.ts
```

It reads `APP_URL`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, stores the first two in Supabase Vault and (re)creates the `pma-process` job. Running it again is safe. The same job keeps a Free project from pausing for inactivity.

## 4. The GitHub App (Connect with GitHub, Build it, See it live)

```bash
npx vercel link
npm run github:app -- prod --url https://<your-app>.vercel.app --name "PMA <your team>"
```

A page on localhost hands GitHub the app's manifest. Check the name (GitHub app names are unique) and click **Create GitHub App**. The script then adds the app's id, keys and secrets to Vercel Production with `vercel env add`. Nothing secret is printed. Redeploy afterwards so the app picks them up.

The app asks for write access to contents and pull requests (Build it commits to a `pma/` branch and opens the pull request) and receives `pull_request` webhooks: when a pull request from Build it merges, its issue is marked shipped. In PMA, **Connect with GitHub** installs the app on a repository. When the installation covers a single repository, PMA connects it right away.

## 5. Slack (optional)

```bash
npm run slack:manifest -- https://<your-app>.vercel.app
```

Create an app from that manifest at [api.slack.com/apps](https://api.slack.com/apps). Copy its Client ID, Client Secret and Signing Secret into Vercel as `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`, then redeploy. Under **Manage Distribution**, turn on public distribution if workspaces other than yours will install it. Companies then press **Add to Slack** in PMA.

## 6. Sentry, PostHog and Granola

These connect per app from **Connect more tools** in PMA, with no server configuration:

- **Sentry**: a user auth token (Sentry > User settings > Personal Tokens) with `org:read`, `project:read` and `event:read`, then pick the project. PMA reads unresolved errors (how many people each reached in 30 days, which counts toward a linked issue's urgency) and turns User Feedback reports into feedback. Self-hosted Sentry works too: enter its URL.
- **PostHog**: a personal API key and its cloud (US or EU), then the project.
- **Granola**: an API key.

Tokens are stored in Supabase Vault, never in a table.

## 7. The demo company (optional)

To show the built-in Celeste sample on your copy, make yourself its owner and load the ready-made data (no Claude calls). Both scripts write to production, so they need `PMA_ALLOW_PROD=1`:

```bash
PMA_ALLOW_PROD=1 node --env-file=.env.prod.local --import tsx scripts/create-user.ts <your GitHub email> --owner
PMA_ALLOW_PROD=1 node --env-file=.env.prod.local --import tsx scripts/seed-snapshot.ts
```

## 8. Use PMA from Claude

The MCP server needs no setup of its own: it is the route `/api/mcp` on your deployment, and the app's API key picks the app, as it does for `/api/v1`. Owners and admins copy the command, key included, from **Settings > Use PMA from Claude**. With a placeholder key it looks like this:

```bash
claude mcp add --transport http pma https://<your-app>.vercel.app/api/mcp --header "Authorization: Bearer YOUR_PMA_API_KEY"
```

The endpoint shown in Settings comes from `APP_URL`, so set that to the address people use. The server only answers requests: intake still runs in the app, so keep the `pma-process` job (step 3) and the GitHub and Slack webhooks (steps 4 and 5) in place.

## Limits of the free plans

- **Supabase Free** pauses a project after about a week without activity. The `pma-process` job counts as activity.
- **Storage** is 1 GB on Supabase Free. Mock-up images live in the `shots` bucket.
- **Vercel Hobby** stops a function after 300 seconds. Build it spreads its work over several calls, so a long build continues on the next one.
