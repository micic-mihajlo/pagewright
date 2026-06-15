# Pagewright

**Natural-language HTML editing that's surgical, versioned, and self-correcting.**

Unlock with a shared passcode, paste or upload an HTML page, and edit it by describing what you want — _"shorten the footer"_, _"change the background to light blue"_, _"make the CTA more prominent"_, _"revert to the last version"_, or _"rebuild this as a modern SaaS landing page."_ Pagewright decides whether each instruction is a surgical edit or a full on-brand regeneration, applies it, validates the result, and saves every variation as an immutable version you can revert to.

It is a demo app, not a production SaaS: the AI editing workflow is the point, and the application — not the model — owns parsing, patching, validation, version history, and preview rendering.

---

## Highlights

- **The system decides edit vs. regeneration.** A cheap classifier routes each instruction (targeted edit / global style / content / section or full regeneration / question / unsupported). Surgical edits stay surgical; whole-page restyles become regenerations — even when phrased as _"make this more product-focused and AI-looking."_
- **Brand-faithful regeneration.** The brand spec (colors, fonts, radii, tone) and content inventory are extracted from your HTML and fed to the model, so a rebuild keeps your palette, typography, claims, and CTAs while improving the layout.
- **Hybrid provider fallback, one clean abstraction.** All model calls go through a single module. It prefers direct Anthropic/OpenAI APIs when their keys are set and falls back to OpenRouter (which proxies both), with cross-vendor failover and per-call logging — no provider branching scattered through the code.
- **Cost- and latency-aware routing.** Obvious edits run on a deterministic, zero-model path. Cheap-tier models handle classification and simple edits; strong-tier models are reserved for regeneration and repair.
- **Self-correction.** Generated output is validated (HTML parse, content preservation, scope) and gets one automatic repair pass before a version is saved.
- **Deterministic versioning & revert.** Every successful change is an immutable version with a full HTML snapshot. Revert never calls a model.
- **Safe preview.** User HTML renders inside a sandboxed iframe; provider keys and the passcode stay server-side in Convex.

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) (React 19, SSR via Nitro) |
| Language | TypeScript |
| UI | Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com), `lucide-react` |
| Backend / DB / storage / actions | [Convex](https://convex.dev) |
| Models | Anthropic, OpenAI, and/or OpenRouter (gateway to both) |
| HTML tooling | DOM parsing + deterministic patch engine, `diff-match-patch` |
| Hosting | Vercel (app) + Convex (backend) |

---

## Architecture

A two-pane editor: **left** — passcode gate, HTML import, run status, version graph, activity log, instruction composer, and a model selector; **right** — sandboxed preview with device toggles, plus source, diff, and validation tabs.

**The client owns** deterministic work that needs no model: the cheap patterns (footer/hero/testimonials/CTA/background), revert, patch application against `before_hash`, and the full validation pass before a version is saved.

**Convex owns** all privileged work: passcode validation and temporary demo sessions, HTML snapshot storage in Convex File Storage, document and immutable version metadata, section indexes / structural summaries / brand specs / content inventories, run history, validation results, and model-call logs.

**The AI pipeline** ([`convex/ai.ts`](convex/ai.ts)) runs entirely server-side:

```
instruction → classify (cheap) → route
   ├─ question_only           → answer, no version
   ├─ targeted/style/content  → scope-constrained patch (cheap, brand-constrained)
   └─ section/full_regen       → brand-aware regeneration (strong)
          ↓
   validate (parse · content preservation · scope)
          ↓  (if it drifts)
   one repair pass (strong)
          ↓
   return HTML + route + model-call logs
```

The provider abstraction ([`convex/providers.ts`](convex/providers.ts)) builds an ordered candidate chain per tier (direct vendor → OpenRouter, across both vendors) and tries each until one succeeds, logging every attempt. The passcode is a **demo access gate, not authentication** — there are no accounts, billing, or team permissions.

---

## Quick Start (local)

**Prerequisites:** Node.js 20+, `pnpm`, a free [Convex](https://convex.dev) account, and at least one model provider key (OpenRouter is the simplest — one key reaches both Anthropic and OpenAI models).

```bash
# 1. Install
pnpm install

# 2. Link a Convex project (writes VITE_CONVEX_URL + CONVEX_DEPLOYMENT to .env.local)
pnpm convex:dev        # leave running, or run `npx convex dev --once` to push and exit

# 3. Configure server-side secrets (stored in Convex, never in the bundle)
npx convex env set APP_PASSCODE "your-demo-passcode"
npx convex env set OPENROUTER_API_KEY "sk-or-..."     # or OPENAI_API_KEY / ANTHROPIC_API_KEY

# 4. Run the app
pnpm dev               # http://localhost:5173
```

Open the app, enter your passcode, and paste or upload an HTML page (a sample is pre-filled).

---

## Environment Variables

Only the variables below are read by the code. The frontend values land in `.env.local`; **all secrets live in Convex env**, never in the client bundle.

### Required

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_CONVEX_URL` | `.env.local` + Vercel | Public Convex URL for the frontend (Convex writes this). |
| `CONVEX_DEPLOYMENT` | `.env.local` | Convex deployment id used by the CLI (Convex writes this). |
| `APP_PASSCODE` | Convex env | Shared demo passcode. Server-side only. |
| **one of** `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Convex env | At least one model provider key. |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_SESSION_TTL_HOURS` | `24` | Lifetime of a demo session token. |
| `AI_MODEL_STRONG_ANTHROPIC` | `claude-opus-4-8` | Strong-tier Anthropic model (regeneration, repair). |
| `AI_MODEL_CHEAP_ANTHROPIC` | `claude-haiku-4-5` | Cheap-tier Anthropic model (classify, simple edits). |
| `AI_MODEL_STRONG_OPENAI` | `gpt-5.5` | Strong-tier OpenAI model. |
| `AI_MODEL_CHEAP_OPENAI` | `gpt-5.4-mini` | Cheap-tier OpenAI model. |

See [`.env.example`](.env.example) for a copy-paste template.

### Providers & model tiers

- Set any combination of the three keys. With **OpenRouter only**, both Anthropic- and OpenAI-class models route through the gateway and still fail over between vendors. Add a **direct** vendor key and that vendor is preferred (no proxy hop), with OpenRouter as backup.
- **Strong** tier = Opus 4.8 / GPT-5.5 (regeneration, repair). **Cheap** tier = Haiku 4.5 / GPT-5.4-mini (classification, targeted edits). Override any of them with the `AI_MODEL_*` vars above.
- In the UI, the composer's **model selector** can pin a specific model (or leave it on _Auto · route by task_). Whatever runs — including any fallback or repair — is recorded on the edit run, shown in the activity log, and stored in the `modelCalls` table.

---

## Deploy

Pagewright builds to an SSR app (TanStack Start compiled by **Nitro**), which Vercel auto-detects via [`vercel.json`](vercel.json) (`"framework": "tanstack-start"`).

1. **Backend:** `npx convex deploy` (or `pnpm convex:deploy`) to push functions to your production Convex deployment, then set the production Convex env (`APP_PASSCODE`, a provider key, optional model overrides).
2. **Frontend:** import the repo in Vercel (or `vercel --prod`). Set `VITE_CONVEX_URL` to the **production** Convex URL. Build command `pnpm build`, install `pnpm install` — no output-directory override needed (Nitro emits the Vercel build output).

---

## Using It

1. **Unlock** with the passcode.
2. **Import** HTML (paste or upload). It's stored as `v0`, then parsed, summarized, and brand-extracted.
3. **Edit** by typing an instruction and pressing **Run edit** (or `⌘ / Ctrl + ↵`). Watch the route, model, and validation in the activity log; each success becomes a new version.
4. **Inspect** via the Preview / Source / Diff / Validation tabs and the device toggles.
5. **Revert** from any node in the version graph — deterministic, no model call.

### Things to try

| Instruction | Expected route |
| --- | --- |
| `shorten the footer` | deterministic targeted edit (no model) |
| `change the background to light blue` | global style edit |
| `make the CTA more prominent` | targeted edit |
| `rebuild this as a modern SaaS landing page` | full regeneration (strong tier, on-brand) |
| `make this more product-focused and AI-looking, keep it on-brand` | full regeneration |
| `revert to the last version` | deterministic revert (no model) |

Pin a specific model in the composer's selector, run an edit, then check the activity log to see which provider/model actually ran.

---

## Resetting the Demo

To wipe all documents, versions, runs, logs, sessions, and stored HTML snapshots back to a clean slate:

```bash
npx convex run admin:resetDemo
```

`admin:resetDemo` is an internal mutation (not callable from the client). After running it, the next visitor lands on the empty import screen.

---

## Project Structure

```
convex/
  ai.ts          # classify → patch/regenerate → validate → repair pipeline
  providers.ts   # hybrid model abstraction (Anthropic/OpenAI/OpenRouter + fallback)
  documents.ts   # versions, runs, model-call logging, revert
  sessions.ts    # passcode gate + demo sessions
  admin.ts       # resetDemo internal mutation
  schema.ts      # Convex tables
src/
  routes/        # TanStack Start routes (__root, index)
  components/
    Editor.tsx   # the two-pane editor
    ui/          # shadcn/ui primitives
  lib/           # html analysis, patch engine, validation (deterministic, client-side)
  styles/app.css # Tailwind v4 + theme tokens
```

---

## Known Limitations

- The passcode is demo access control, **not** authentication.
- Freeform/regeneration edits need at least one provider key set in Convex.
- Very large HTML beyond the configured snapshot size is rejected for direct freeform edits; the deterministic targeted path still applies.
- Complex JavaScript inside arbitrary user HTML may not preserve runtime behavior; external assets can fail if they require auth or block embedding.
- Screenshot / visual-diff validation is not implemented.

---

## Security Notes

No API keys, passcodes, or secrets are committed to this repository. Set `APP_PASSCODE` and at least one provider key yourself, in Convex environment variables. Provider/API calls are server-side only; the sandboxed preview iframe never receives backend tokens.
