# llm

Summarise, classify, extract, chat — without the app dying the moment the
API does. Provider-agnostic client, token streaming, and a
validate-and-retry pattern for structured JSON, all behind one interface
that works with zero keys.

## What's here

| File | What |
|---|---|
| `llm.js` | Dual… triple-backend client: no key → **mock mode** (canned response, no network); `VITE_ANTHROPIC_API_KEY` → Anthropic; `VITE_GOOGLE_API_KEY` → Google Gemini. One call, `complete({ system, prompt, schema })`, same shape either way. Never throws. |
| `stream.js` | Token-by-token delivery on top of `llm.js`. Real SSE parsing for Anthropic/Gemini, hand-rolled (no SDK). Falls back to a single non-streamed chunk in mock mode. Returns `{ done, cancel }` so a Stop button has something to call. |
| `extract.js` | Structured extraction: asks for JSON against a small schema, validates what comes back, retries once with the validation error fed back into the prompt. Returns `{ data, error }` — `data` either fully matches the schema or is `null`. On Anthropic this rides on top of native structured output (`output_config`, see below); on every other backend it's the only thing keeping the response honest — either way, every response is still parsed and validated here. |
| `Prompt.jsx` | Input + streaming output panel (React function component, hooks-based). Loading, empty, error, and "running in mock mode" states, plus a Stop control. |
| `extract.test.mjs` | `node --test src/recipes/llm/extract.test.mjs` — valid response, malformed JSON, missing required field, retry-succeeds, retry-fails-twice. Stubs the transport; no network calls. |

## Copy it in

```bash
cp -r src/recipes/llm src/lib/llm
```

```jsx
import Prompt from './lib/llm/Prompt.jsx'

export default function App() {
  return <Prompt system="You summarise customer complaints in one sentence." />
}
```

Or use the pieces directly:

```js
import { complete } from './lib/llm/llm.js'
import { extract } from './lib/llm/extract.js'

const { data, error } = await complete({ prompt: 'Summarise: ...' })

const { data: person, error: err } = await extract({
  prompt: 'Extract the customer name and complaint category from: ...',
  schema: {
    type: 'object',
    properties: { name: { type: 'string' }, category: { type: 'string', enum: ['billing', 'bug', 'other'] } },
    required: ['name', 'category'],
  },
})
```

## Env vars

None are required — with nothing set, `backend` (exported from `llm.js`) is
`'mock'` and every call above works with no network and no key.

| Var | Backend | Required |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | Anthropic (checked first) | to use Claude |
| `VITE_ANTHROPIC_MODEL` | Anthropic | no — defaults to `claude-haiku-4-5` |
| `VITE_GOOGLE_API_KEY` | Google Gemini (used if no Anthropic key) | to use Gemini |
| `VITE_GOOGLE_MODEL` | Google Gemini | no — defaults to `gemini-2.0-flash` |

**Anthropic model tiers**, all exact IDs (no date suffix, no `-latest`):
`claude-haiku-4-5` (default here — cheapest and fastest, right call for a
demo where latency matters more than depth), `claude-sonnet-5` (step up for
harder extraction/classification), `claude-opus-5` (top tier). Set
`VITE_ANTHROPIC_MODEL` to switch.

**Google model default is unverified.** `gemini-2.0-flash` is left as-is
because it could not be confirmed against an authoritative source at the
time this recipe was written — check
[Google's current Gemini model list](https://ai.google.dev/gemini-api/docs/models)
before relying on it, and override with `VITE_GOOGLE_MODEL` if it's stale.

## Native structured output (Anthropic)

When the backend is Anthropic and `extract()`/`complete()` is called with a
`schema`, `llm.js` sends it as `output_config: { format: { type:
'json_schema', schema } }` on the Messages API request (GA, current as of
`docs.claude.com/en/docs/build-with-claude/structured-outputs` — no beta
header needed). Anthropic constrains the response server-side instead of
only hoping the model followed a text instruction; the JSON still comes
back in the normal text content block, so nothing downstream changes.

This is a preferred path, not a replacement: `extract.js` still parses and
validates every response and still retries once on failure, for Anthropic
and for every other backend. Google Gemini and mock mode have no
equivalent native constraint here, so for them the prompt-plus-schema text
instruction (`schemaPromptSuffix` in `llm.js`) plus `extract.js`'s
validate-and-retry loop is the only thing enforcing the shape — which is
exactly why that loop was built provider-agnostic in the first place, and
why it isn't going away now that Anthropic has a native option.

Not covered by `extract.test.mjs`: like the real Anthropic/Google branches
of `llm.js` generally (see "Verifying this recipe" below), the
`output_config` request shape isn't exercised by an automated test in this
recipe — `import.meta.env` can't be stubbed under plain `node --test` the
way `localStorage`/`window` are in `../auth/auth.test.mjs`, so this needs a
real key and a by-hand check, same as the rest of the non-mock code paths.

## Security — read this before you set a key

**Putting a real provider key in a browser build exposes it to anyone who
opens devtools.** `import.meta.env.VITE_*` values are baked into the
JavaScript bundle at build time — not hidden, not encrypted, just sitting in
a `.js` file anyone can view in the Network tab, in "View Source", or by
downloading the deployed app and running `strings` on it. This is true no
matter how the key is set (`.env`, Cloudflare Pages env var, whatever) —
anything prefixed `VITE_` ships to the client, by Vite's own design. This
recipe calls Anthropic/Google directly from `fetch()` in the browser
*specifically so it's copy-paste-and-go for a demo* — that convenience is
the whole risk. A key spent this way can be used by anyone who looked, on
your account, until you revoke it.

**Safe pattern: put a proxy in front of the key.** For this stack, the
right shape is a **Cloudflare Pages Function** — it deploys alongside the
app you're already shipping, needs no extra service, and the key lives in a
Pages *environment variable without the `VITE_` prefix*, which is never
bundled into client JS.

```js
// functions/api/llm.js  (Cloudflare Pages Function - NOT in this recipe folder)
export async function onRequestPost({ request, env }) {
  const { system, prompt } = await request.json()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY, // set in the Pages dashboard, no VITE_ prefix
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1024, system, messages: [{ role: 'user', content: prompt }] }),
  })
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
}
```

Then point `llm.js` at `/api/llm` instead of `api.anthropic.com` (swap the
`fetch()` URL and drop the `x-api-key` header — the Function adds it
server-side). This is the one change worth making before a key goes near
anything beyond `localhost` and your own eyes. Cloudflare Pages Functions
aren't wired up in this recipe — building one is outside this folder — this
README section is the pointer, the code above is the shape.

**Only the Anthropic/Google keys are relevant here** — same rule the rest
of the starter kit already follows for the Supabase anon key (see
`src/lib/db.js` and the project's `preflight.sh`): nothing secret belongs
in a client bundle without a proxy in front of it.

## The 3 gotchas

1. **Streaming in mock mode is not progressive.** `stream.js` falls back to
   `llm.js`'s non-streaming `complete()` when `backend === 'mock'`, then
   delivers the whole canned answer as a single `onChunk` call. If you're
   demoing the streaming UI before any key exists, the text will appear all
   at once after the mock delay, not token by token — that's expected, not
   a bug. Wire a real key to see the actual streaming behaviour.

2. **This calls providers straight from the browser, which is the whole
   security tradeoff above.** `anthropicComplete`/`anthropicStream` send
   `anthropic-dangerous-direct-browser-access: true` specifically so a
   direct `fetch()` from client JS doesn't get blocked — that header makes
   the request *work*, it does not make shipping a real key *safe*. Read
   the Security section before pointing this at a production Anthropic or
   Google key.

3. **Model IDs must be exact — no date suffix, no `-latest`.** Anthropic's
   `-latest` aliases (e.g. the old `claude-3-5-haiku-latest`) are retired;
   use the bare tier name (`claude-haiku-4-5`, `claude-sonnet-5`,
   `claude-opus-5`), not a dated snapshot like
   `claude-haiku-4-5-20251001`. Both `VITE_ANTHROPIC_MODEL` and
   `VITE_GOOGLE_MODEL` exist because providers rename and deprecate models
   on their own schedule regardless — if a request suddenly starts failing
   with `kind: 'unknown'` and a 404 in the message, it's very likely the
   model id, not your key or your code. The Google default in particular is
   unverified (see the env var table above) — check the provider's current
   docs and override rather than debugging around it.

## Verifying this recipe

```bash
node --test src/recipes/llm/extract.test.mjs
```

7 tests, all passing as shipped — valid response, malformed JSON, missing
required field, retry-succeeds-on-second-attempt (asserting the retry
prompt actually carries the validation error), retry-fails-twice, and two
input-validation guards. Every test stubs `complete` directly; none touch
the network.

`llm.js`, `stream.js`, and `extract.js` were also exercised by hand in mock
mode end-to-end (`complete()` with and without a schema, `streamComplete()`
including its cancel path, and `extract()`) — all return the expected
`{ data, error }` shapes with zero setup, which is the point: this recipe
is meant to be buildable and demoable before a single key exists.
`Prompt.jsx` was smoke-compiled with `esbuild` (`--loader:.jsx=jsx
--jsx=automatic`) to confirm it's valid React — this repo's build isn't run
from inside a recipe folder, see `../README.md`.
