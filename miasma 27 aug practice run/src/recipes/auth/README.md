# auth

Sign-in that does not put a wall in front of a judge. Read
`../../../playbook/01-rubric.md` first — "Signup wall in front of the demo"
is listed under **what loses criterion 1**, next to "demoing on localhost."
This recipe exists so that line never applies to you.

## What's here

| File | What |
|---|---|
| `auth.js` | Dual-backend auth adapter. Mirrors `src/lib/db.js`: no Supabase env vars → local demo mode (localStorage, instant, no email); Supabase env vars → real magic-link auth. Same API either way. |
| `AuthGate.jsx` | Wraps a piece of the app. Three modes: `optional` (default, never blocks), `demo` (one-tap, no email), `required` (real sign-in, blocks). |
| `SignIn.jsx` | Email input → magic link → "check your email" state. Handles invalid email, send failure, rate limiting, and changing your mind about the address. |
| `auth.test.mjs` | `node --test src/recipes/auth/auth.test.mjs` — email validation, rate-limit detection, and the local session round trip. Passing as shipped. |

## Copy it in

```bash
cp -r src/recipes/auth src/lib/auth
```

Then in whatever screen needs it:

```jsx
import AuthGate from './lib/auth/AuthGate.jsx'

function Screen() {
  return (
    <AuthGate mode="optional">
      <YourCoreLoop />
    </AuthGate>
  )
}
```

Nothing else in the app needs to change. `auth.js` reads the same
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` that `db.js` already reads —
if you've wired one, the other upgrades for free.

## Switching modes

Set the `mode` prop on `AuthGate`:

- **`optional`** (default) — content always renders, signed in or not. A
  small bar offers "Sign in" when signed out; identity + sign-out when
  signed in. Use this for anything that works fine anonymously — the local
  backend already scopes localStorage per browser, which is a perfectly
  real "account" for a 4-hour demo.
- **`demo`** — content is replaced by a single "Continue as demo user"
  button until there's a session. No email, one tap. Use this when the
  feature genuinely needs *a* user (so "my" data has somewhere to live) but
  a real account would cost the judge more than one click.
- **`required`** — content is replaced by the real email + magic-link form
  until there's a session. This is the one mode the rubric explicitly
  penalises if it sits in front of the demo.

All three modes show the signed-in identity and a sign-out control once
there's a session — that part doesn't depend on `mode`.

## Which mode for the hackathon demo — bluntly

**Use `optional`, or `demo` if the feature needs a user. Never `required` in
front of the thing you're demoing.**

- `optional` is the safest default for almost everything. The judge opens
  the link and the core loop just works, exactly like the rest of the
  starter kit. If you want to *show* auth exists (some rubrics reward
  seeing the concept), the small "Sign in" bar is visible without blocking
  anything.
- `demo` is for the specific case where the feature is inherently
  per-user — a dashboard of "my" items, a role, a saved profile — and you
  need *something* in the user slot. One tap, no typing, no waiting on an
  email that might land in spam mid-demo.
- `required` is real auth for real users. It is correct for the app you
  ship to actual people after the hackathon. It is a liability for the
  version a judge clicks on stage: if the magic link is slow, or lands in
  spam, or the judge fat-fingers their email, criterion 1 is lost before
  they've seen anything you built. If the brief truly demands accounts,
  put a seeded demo login in plain text on the landing page (the rubric's
  own suggested fix) rather than trusting the live email round trip.

If you're unsure, start with `optional`, wire the real thing behind
`demo`/`required` in a corner of the app, and only promote it if there's
time left at minute 215.

## Local vs Supabase, concretely

No `.env` values → **local mode**. `auth.signIn()` (no email) or
`auth.signIn(email)` both resolve instantly with a fake session in
localStorage — there's no mail server to round-trip to, so `SignIn.jsx`'s
"check your email" state is simply never reached. Good enough to demo the
whole auth *concept* with zero setup, and it's what you get by default with
this recipe copied in and nothing else configured.

`.env` filled in → **Supabase mode**. Two different flows depending on how
`signIn` is called:

- `auth.signIn(email)` — a real magic link via `supabase.auth.signInWithOtp`.
- `auth.signIn()` (no email) — a real *anonymous* session via
  `supabase.auth.signInAnonymously()`. This is what `AuthGate mode="demo"`
  calls. It's a real, RLS-capable session (so per-user Supabase rows still
  work) that costs the judge zero typing.

### Supabase dashboard settings you need — this is the 20-minute loss

Two separate settings bite people. Both live under
**Authentication** in the Supabase dashboard, and both are easy to skip
because everything works fine against `localhost` and then silently breaks
the moment you deploy.

1. **Redirect URL allow-list (breaks the magic link on `*.pages.dev`).**
   Supabase rejects any `emailRedirectTo` that isn't on the allow-list — the
   link opens, Supabase 400s, and the judge lands on an error page instead
   of your app. Go to **Authentication → URL Configuration** and add your
   deployed URL to **Redirect URLs**, *not just* Site URL:

   ```
   https://your-project.pages.dev/**
   ```

   Cloudflare Pages gives every deploy its own preview subdomain
   (`<hash>.your-project.pages.dev`), so if you're testing preview deploys
   too, add the wildcard form:

   ```
   https://*.your-project.pages.dev/**
   ```

   Do this **before** the first real test of the magic link, not after it
   fails. It looks like a code bug (link opens, session never sets) and
   isn't.

2. **Anonymous sign-ins (breaks `mode="demo"` against Supabase).**
   `signInAnonymously()` is off by default. If it's off, `auth.signIn()`
   returns an error and `AuthGate mode="demo"` shows it inline instead of
   signing anyone in. Go to **Authentication → Sign In / Providers** and
   turn on **Allow anonymous sign-ins**. If you don't need `mode="demo"`
   against a real Supabase backend, you can skip this — `optional` and
   `required` don't touch it.

## Verifying this recipe

```bash
node --test src/recipes/auth/auth.test.mjs
```

Covers `isValidEmail`, `isRateLimitError`, and the full local-backend
session lifecycle (sign in with/without an email, sign out, subscribe
firing on every change, unsubscribe actually stopping callbacks). The
Supabase branch isn't covered by this file — it needs a real project — so
sanity-check the magic link and the redirect setting above by hand once
keys are in `.env`.
