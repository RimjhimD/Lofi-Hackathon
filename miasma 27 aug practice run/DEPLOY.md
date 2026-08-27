# Deploy

## Why this is the first thing you do

The rubric says *working and live*. Teams lose that criterion in the last twenty
minutes: the app runs locally, the deploy breaks, and they demo a localhost.

Deploying an empty app first inverts the risk. Once "hello world" is on a public
URL, every later push is already shipped, and any deploy problem surfaces at
18:25 when there is time — instead of at 21:50 when there isn't.

**Target: both problems have a live URL by minute 30.** Before either has a
feature.

## Cloudflare Pages — direct upload (fastest)

No GitHub connection, no build configuration, no waiting on a CI queue. Wrangler
uploads the built `dist/` straight to the edge.

On the night, per problem, from that problem's copy of the kit:

```bash
npx wrangler pages project create problem-a --production-branch main   # once
npm run deploy -- --project-name problem-a                              # every push
```

`npm run deploy` runs `vite build` then `wrangler pages deploy dist`. Wrangler
is a pinned devDependency (4.123.0), so nothing is fetched at deploy time.
Name the project after the problem, not the template. The deploy prints the
live URL: `https://<project>.pages.dev` (plus a per-deploy preview hash URL —
give judges the bare project URL).

The account is already authorised on this machine (`npx wrangler whoami` shows
`shinzuu.dev@gmail.com`). If that ever lapses: `npx wrangler login`, one browser
consent click — do it on home wifi, never at 18:20.

Measured on 17 August: build 0.4s, upload 1.3s, URL serving 200 within ten
seconds. About 15 seconds end to end.

### Environment variables

`VITE_` variables are baked in at build time, so a local `.env` is enough for
direct upload — no dashboard configuration needed. Changing keys means
rebuilding and redeploying.

Only the Supabase **anon** key ever goes in. It ships inside the JavaScript
bundle and is readable by anyone; that is what row-level security is for. The
`service_role` key must never appear in a client build.

## Fallbacks

If Cloudflare is uncooperative on the night, any of these gets a static `dist/`
live in under two minutes. Have a second account already logged in.

| Host | Command | Notes |
|---|---|---|
| Netlify | `npx netlify-cli deploy --prod --dir dist` | Drag-and-drop also works at app.netlify.com/drop — no CLI, no login on some accounts |
| Vercel | `npx vercel --prod` | Detects Vite automatically |
| GitHub Pages | push `dist/` to `gh-pages` | Slowest; needs a repo and can take minutes to propagate |
| Surge | `npx surge dist` | No account setup beyond an email |

Do not spend more than 10 minutes fighting one host. Switch.

## Custom domain

Skip it. It costs 15 minutes, risks DNS propagation not completing before 22:00,
and scores nothing. `*.pages.dev` is a live URL.

## Smoke test after every deploy

Thirty seconds, on a phone, on mobile data — not on the venue wifi that already
has the app cached:

1. Open the URL cold. It loads, no blank screen.
2. Core loop completes end to end.
3. Refresh. Data is still there.
4. One deliberately wrong input. Message, not crash.

## Rehearsal record — 17 August

Full path run once, start to finish, from this machine:

| Step | Result |
|---|---|
| `npm i -D wrangler` | 4.123.0 pinned; `deploy` script no longer uses `npx wrangler@latest` |
| `wrangler whoami` | already authorised as `shinzuu.dev@gmail.com` — no login needed |
| `wrangler pages project create hackathon-rehearsal --production-branch main` | non-interactive, no prompts |
| `wrangler pages deploy dist --project-name hackathon-rehearsal` | 4 files, 1.25s upload |
| `curl` the URL | 200 in 0.3s, correct `<title>` |

Live at <https://hackathon-rehearsal.pages.dev>. Every step was a command, not
a decision. Still to do: open it on a phone on mobile data and run the smoke
test above. Leave the rehearsal project in place — it proves the account works
on the night without touching a real problem project.
