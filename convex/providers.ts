// ============================================================
// Provider abstraction — one place for all model calls.
//
// Hybrid strategy: prefer direct native vendor APIs when their key is set,
// fall back to OpenRouter (which proxies both vendors) when a key is missing
// or a call fails. Cross-vendor graceful fallback is built in: a strong-tier
// request will try Anthropic, then OpenAI, across whatever transports exist.
// ============================================================

export type ModelTier = "cheap" | "strong";
export type Vendor = "anthropic" | "openai";
export type Transport = "anthropic" | "openai" | "openrouter";

export type ModelCallLog = {
  task: string;
  tier: ModelTier;
  transport: Transport;
  vendor: Vendor;
  model: string;
  latencyMs: number;
  status: "ok" | "error";
  fallback: boolean;
  error?: string;
};

export type RunResult = {
  text: string;
  vendor: Vendor;
  transport: Transport;
  model: string;
  tier: ModelTier;
  fallbackUsed: boolean;
  calls: ModelCallLog[];
};

type Candidate = {
  transport: Transport;
  vendor: Vendor;
  model: string;
};

// ---- Model registry (env-overridable, researched mid-2026 defaults) -------

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const MODELS = {
  anthropic: {
    strong: () => env("AI_MODEL_STRONG_ANTHROPIC", "claude-opus-4-8"),
    cheap: () => env("AI_MODEL_CHEAP_ANTHROPIC", "claude-haiku-4-5"),
  },
  openai: {
    strong: () => env("AI_MODEL_STRONG_OPENAI", "gpt-5.5"),
    cheap: () => env("AI_MODEL_CHEAP_OPENAI", "gpt-5.4-mini"),
  },
};

// OpenRouter slugs for the same models. OpenRouter uses dotted version numbers
// (anthropic/claude-opus-4.8), while the native Anthropic API uses dashes
// (claude-opus-4-8) — convert the trailing major-minor for Anthropic.
function openRouterSlug(vendor: Vendor, model: string): string {
  if (model.includes("/")) return model;
  if (vendor === "anthropic") {
    return `anthropic/${model.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
  }
  return `openai/${model}`;
}

function hasKey(transport: Transport): boolean {
  if (transport === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (transport === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function anyProviderConfigured(): boolean {
  return (
    hasKey("anthropic") || hasKey("openai") || hasKey("openrouter")
  );
}

// The manual catalog the UI exposes. "auto" defers to tier routing.
export const MODEL_CATALOG = [
  { id: "auto", label: "Auto (route by task)", tier: null as ModelTier | null },
  { id: "anthropic:strong", label: "Claude Opus 4.8", tier: "strong" as ModelTier },
  { id: "anthropic:cheap", label: "Claude Haiku 4.5", tier: "cheap" as ModelTier },
  { id: "openai:strong", label: "GPT-5.5", tier: "strong" as ModelTier },
  { id: "openai:cheap", label: "GPT-5.4 mini", tier: "cheap" as ModelTier },
] as const;

function vendorModel(vendor: Vendor, tier: ModelTier): string {
  return MODELS[vendor][tier]();
}

// Build the ordered candidate chain for a tier. Direct vendor transports come
// first (cheaper, no proxy hop), then OpenRouter equivalents as fallback. A
// manual `{vendor, tier}` pin is hoisted to the front but the rest remain as
// failover so a single provider hiccup never hard-fails the request.
function buildChain(tier: ModelTier, pinned?: { vendor: Vendor }): Candidate[] {
  const order: Vendor[] = pinned
    ? [pinned.vendor, pinned.vendor === "anthropic" ? "openai" : "anthropic"]
    : ["anthropic", "openai"];

  const chain: Candidate[] = [];
  for (const vendor of order) {
    const model = vendorModel(vendor, tier);
    if (hasKey(vendor)) {
      chain.push({ transport: vendor, vendor, model });
    }
    if (hasKey("openrouter")) {
      chain.push({ transport: "openrouter", vendor, model: openRouterSlug(vendor, model) });
    }
  }
  // De-dupe identical transport+model entries while preserving order.
  const seen = new Set<string>();
  return chain.filter((candidate) => {
    const key = `${candidate.transport}:${candidate.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveTier(manualModelId: string | undefined, autoTier: ModelTier): {
  tier: ModelTier;
  pinned?: { vendor: Vendor };
} {
  if (!manualModelId || manualModelId === "auto") {
    return { tier: autoTier };
  }
  const [vendor, tier] = manualModelId.split(":") as [Vendor, ModelTier];
  if ((vendor === "anthropic" || vendor === "openai") && (tier === "cheap" || tier === "strong")) {
    return { tier, pinned: { vendor } };
  }
  return { tier: autoTier };
}

// ---- The single entry point -----------------------------------------------

export async function runStructured(opts: {
  task: string;
  tier: ModelTier;
  system: string;
  user: string;
  maxTokens?: number;
  pinned?: { vendor: Vendor };
}): Promise<RunResult> {
  const chain = buildChain(opts.tier, opts.pinned);
  if (chain.length === 0) {
    throw new Error(
      "No model provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in Convex env.",
    );
  }

  const calls: ModelCallLog[] = [];
  let lastError = "";

  for (let index = 0; index < chain.length; index += 1) {
    const candidate = chain[index];
    const startedAt = Date.now();
    try {
      const text = await callTransport(candidate, opts);
      calls.push({
        task: opts.task,
        tier: opts.tier,
        transport: candidate.transport,
        vendor: candidate.vendor,
        model: candidate.model,
        latencyMs: Date.now() - startedAt,
        status: "ok",
        fallback: index > 0,
      });
      return {
        text,
        vendor: candidate.vendor,
        transport: candidate.transport,
        model: candidate.model,
        tier: opts.tier,
        fallbackUsed: index > 0,
        calls,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Model call failed.";
      calls.push({
        task: opts.task,
        tier: opts.tier,
        transport: candidate.transport,
        vendor: candidate.vendor,
        model: candidate.model,
        latencyMs: Date.now() - startedAt,
        status: "error",
        fallback: index > 0,
        error: lastError,
      });
    }
  }

  const error = new Error(
    `All ${chain.length} model attempt(s) failed. Last error: ${lastError}`,
  );
  (error as Error & { calls?: ModelCallLog[] }).calls = calls;
  throw error;
}

async function callTransport(candidate: Candidate, opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 8192;
  if (candidate.transport === "anthropic") {
    return await callAnthropic(candidate.model, opts.system, opts.user, maxTokens);
  }
  if (candidate.transport === "openai") {
    return await callOpenAI(candidate.model, opts.system, opts.user, maxTokens);
  }
  return await callOpenRouter(candidate.model, candidate.vendor, opts.system, opts.user, maxTokens);
}

// ---- Transports -----------------------------------------------------------

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  // Opus 4.8 / current Anthropic models: no temperature/top_p, adaptive thinking.
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: `${user}\n\nReturn JSON only. No markdown fences.` }],
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `Anthropic ${response.status}`);
  }
  const text = Array.isArray(body.content)
    ? body.content
        .filter((part: { type?: string; text?: string }) => part.type === "text" && part.text)
        .map((part: { text: string }) => part.text)
        .join("\n")
    : "";
  if (!text) throw new Error("Anthropic returned no text.");
  return text;
}

async function callOpenAI(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: maxTokens,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: { format: { type: "json_object" } },
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI ${response.status}`);
  }
  const text = extractOpenAIText(body);
  if (!text) throw new Error("OpenAI returned no text.");
  return text;
}

async function callOpenRouter(
  model: string,
  vendor: Vendor,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };
  // Anthropic models reject sampling params; only set temperature for OpenAI.
  if (vendor === "openai") {
    payload.temperature = 0.3;
  }
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://pagewright-six.vercel.app",
      "X-Title": "Pagewright",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter ${response.status}`);
  }
  const text = body?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenRouter returned no text.");
  return text;
}

function extractOpenAIText(body: { output_text?: string; output?: unknown[] }): string {
  if (typeof body.output_text === "string" && body.output_text) {
    return body.output_text;
  }
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output as Array<{ content?: Array<{ type?: string; text?: string }> }>) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
