# Pagewright

Pagewright is a demo natural-language HTML editor. A user unlocks the app with a shared demo passcode, pastes or uploads an HTML page, previews it in a sandboxed iframe, then asks for edits such as "shorten the footer", "change the background to light blue", "revert to the last version", or "rebuild this as a modern SaaS landing page".

The MVP is intentionally not a production SaaS product. It is a versioned editing workflow where the model proposes structured changes and the app owns parsing, patching, validation, version history, and preview rendering.

## Stack

- Vite, React, and TypeScript for the client app.
- Convex for backend functions, database state, file storage, and AI workflows.
- Vercel for hosting the Vite app.
- Deterministic TypeScript patching for canonical targeted edits, plus server-side provider-backed freeform editing through OpenRouter, OpenAI, or Anthropic.
- `diff-match-patch`, `clsx`, and `lucide-react` for UI and diff support.

## Architecture

The frontend presents a two-pane editor: chat, run status, and version timeline on the left; rendered preview, source, diff, and validation details on the right. The preview must render user HTML inside an iframe sandbox and must not expose backend tokens or provider keys.

Convex owns privileged work:

- passcode validation and temporary demo sessions
- HTML snapshot storage in Convex File Storage
- document and immutable version metadata
- section indexes, structural summaries, brand specs, and content inventories
- version creation, validation metadata, run history, and model-call/provider metadata

The app uses a simple demo passcode, not full auth. Do not add Clerk, OAuth, account signup, billing, or team permissions for the MVP.

## No Secrets Included

No API keys are included in this repository. Set `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, and/or `ANTHROPIC_API_KEY` yourself. Set `APP_PASSCODE` yourself. Keep model provider keys and the passcode server-side in Convex environment variables, not in frontend code.

## Local Setup

Prerequisites:

- Node.js and pnpm
- Convex CLI access to Mihajlo's personal Convex account
- Optional OpenAI and/or Anthropic API key for model-backed edits

Install dependencies:

```bash
pnpm install
```

Create local environment placeholders:

```bash
cp .env.example .env.local
```

Start or configure Convex:

```bash
pnpm convex dev
```

You can also use the package script:

```bash
pnpm convex:dev
```

On first run, Convex will prompt you to create or link a project and should populate local Convex values such as `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT` in `.env.local`.

Set required server-side Convex environment variables:

```bash
pnpm convex env set APP_PASSCODE "replace-with-your-demo-passcode"
pnpm convex env set DEMO_SESSION_TTL_HOURS "24"
```

The deployed app uses deterministic patching for canonical targeted edits and a server-side provider action for freeform edits. Set at least one model provider key:

```bash
pnpm convex env set AI_PROVIDER "openrouter"
pnpm convex env set OPENROUTER_API_KEY "replace-with-your-openrouter-key"
pnpm convex env set AI_MODEL_PATCHER "openai/gpt-4o-mini"
```

or use OpenAI directly:

```bash
pnpm convex env set AI_PROVIDER "openai"
pnpm convex env set OPENAI_API_KEY "replace-with-your-openai-key"
```

or:

```bash
pnpm convex env set AI_PROVIDER "anthropic"
pnpm convex env set ANTHROPIC_API_KEY "replace-with-your-anthropic-key"
```

Run the frontend dev server:

```bash
pnpm dev
```

Build locally:

```bash
pnpm build
```

## Environment Variables

Use `.env.example` as the template and keep real values in `.env.local`, Convex dashboard settings, or deployment environment variables.

| Variable | Required | Where | Purpose |
| --- | --- | --- | --- |
| `VITE_CONVEX_URL` | Yes | Vercel and local Vite env | Public Convex URL used by the frontend. |
| `CONVEX_DEPLOYMENT` | Yes | Local Convex env | Convex deployment identifier used by the CLI. |
| `APP_PASSCODE` | Yes | Convex env | Shared demo passcode. Must not be exposed to the client bundle. |
| `DEMO_SESSION_TTL_HOURS` | Yes | Convex env | Expiration window for temporary demo sessions. |
| `AI_PROVIDER` | Optional | Convex env | Primary provider: `openrouter`, `openai`, or `anthropic`. |
| `OPENROUTER_API_KEY` | Optional | Convex env | Required when using OpenRouter. |
| `OPENAI_API_KEY` | Optional | Convex env | Required when using OpenAI. |
| `ANTHROPIC_API_KEY` | Optional | Convex env | Required when using Anthropic. |
| `AI_FALLBACK_ENABLED` | Optional | Convex env | Enables fallback when both providers are configured. |
| `AI_MODEL_CLASSIFIER` | Optional | Convex env | Model override for instruction routing. |
| `AI_MODEL_PATCHER` | Optional | Convex env | Model override for structured patch generation. |
| `AI_MODEL_REGEN` | Optional | Convex env | Model override for section or full-page regeneration. |
| `AI_MODEL_JUDGE` | Optional | Convex env | Model override for content preservation and brand drift checks. |
| `AI_MODEL_EMBEDDINGS` | Optional | Convex env | Model override for section embeddings. |
| `MAX_REPAIR_ATTEMPTS` | Optional | Convex env | Maximum automatic repair retries after validation failure. |
| `MAX_DIRECT_MODEL_HTML_TOKENS` | Optional | Convex env | Threshold above which full HTML must not be sent directly to a model. |
| `ENABLE_PLAYWRIGHT_VALIDATION` | Optional | Convex env | Enables browser/screenshot validation if implemented. |
| `PREVIEW_ORIGIN` | Optional | Convex or Vercel env | Dedicated preview origin if preview isolation is split later. |
| `SCREENSHOT_STORAGE_ENABLED` | Optional | Convex env | Enables storing validation screenshots if implemented. |

## Convex Setup

1. Log in to the Convex CLI with the personal account that will own the demo.
2. Run `pnpm convex dev` and create or link the project when prompted.
3. Keep `APP_PASSCODE`, provider keys, model defaults, and validation settings in Convex environment variables.
4. Store raw HTML snapshots in Convex File Storage. Do not store oversized raw HTML directly inside Convex documents.
5. Use Convex tables for documents, versions, chat messages, edit runs, patch ops, validation results, section indexes, demo sessions, and model call metadata.

For production:

```bash
pnpm convex deploy
```

or:

```bash
pnpm convex:deploy
```

After deployment, copy the production Convex URL into Vercel as `VITE_CONVEX_URL`.

## Vercel Deploy

This is a Vite single-page app. `vercel.json` rewrites all routes to `index.html` so client-side routing works after refreshes and direct links.

Recommended Vercel settings:

- Framework preset: Vite
- Install command: `pnpm install`
- Build command: `pnpm build`
- Output directory: `dist`
- Environment variable: `VITE_CONVEX_URL=<production Convex URL>`

Deploy flow:

```bash
pnpm build
pnpm convex deploy
vercel
vercel --prod
```

Set `APP_PASSCODE`, provider keys, and server-side model settings in Convex for the production deployment. Only add them to Vercel if future Vercel server functions require them.

## Oversized HTML Strategy

The oversized requirement is central to the MVP. The app must not truncate a large HTML file and pretend the model saw the complete page.

Ingestion should create these artifacts:

- raw HTML snapshot in Convex File Storage
- parsed DOM tree with stable internal node IDs
- logical section map
- CSS rule index and asset manifest
- global structural summary
- section summaries and section hashes
- extracted brand/style spec
- content inventory
- optional embeddings for section retrieval

For targeted edits, the model should receive only the global summary, brand spec, relevant section HTML, relevant CSS rules, nearby context when needed, the user instruction, and the structured patch schema. For example, "shorten the footer" should retrieve footer context rather than sending the full page.

For full regeneration, the future model-backed app should build a blueprint from the brand spec and content inventory, regenerate section by section, reassemble deterministically, then validate content survival and brand consistency before activating the new version.

## Validation and Self-Correction

Model-generated changes must be validated before a version becomes active. The app should prefer structured model outputs and deterministic application logic:

1. Classify the user instruction into a route such as `targeted_edit`, `global_style_edit`, `full_regeneration`, `revert`, or `unsupported`.
2. Generate structured patch operations for targeted edits.
3. Apply patch ops only when the target and `before_hash` still match.
4. Validate HTML parsing, allowed scope, content inventory, CSS sanity, saved snapshot, and preview loadability.
5. Attempt automatic repair only for model-generated edits, up to `MAX_REPAIR_ATTEMPTS`.
6. Save and activate only passed or acceptable warning-level results.
7. Keep failed runs visible, but do not silently activate broken HTML.

Revert is deterministic and must not call a model. It creates a new version whose HTML equals a previous snapshot.

## QA Checklist

Automated tests are not configured yet. Until they are added, use this manual checklist plus `pnpm lint` and `pnpm build`.

- Unlock the app with the configured passcode and reject an incorrect passcode.
- Paste initial HTML and verify version `v0` is saved.
- Upload an `.html` file and verify the same ingestion path runs.
- Confirm the preview renders inside a sandboxed iframe and cannot navigate the parent app.
- Ask "shorten the footer" and verify the route is targeted, only footer/footer CSS changes, validation is shown, and a new version is saved.
- Ask "change the background to light blue" and verify the change is treated as a style edit without content rewrites.
- Ask "revert to the last version" and verify no model call is made, a new version is created, and history is preserved.
- Test a large HTML fixture above `MAX_DIRECT_MODEL_HTML_TOKENS`; verify only relevant section context plus summaries are sent for a targeted edit.
- Force a bad model output or invalid patch and verify validation catches it, repair is attempted, and broken output is not activated.
- Run with OpenRouter-only, OpenAI-only, Anthropic-only, and fallback combinations when credentials are available.
- Confirm no real API keys, passcodes, customer data, or provider secrets are committed.

## Known Limitations

- The shared passcode is demo access control, not production authentication.
- Provider-backed freeform edits are enabled when `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` is configured server-side.
- Complex JavaScript inside arbitrary user HTML may not preserve runtime behavior.
- External assets may fail if they require authentication, block embedding, or depend on a specific origin.
- Screenshot or visual diff validation is optional unless a Playwright worker is implemented.
- Holistic full-page regeneration is a stretch path after targeted editing, versioning, and validation are reliable.
- The MVP is not a website publishing workflow and does not include custom domains, asset proxying, billing, accounts, or team permissions.
