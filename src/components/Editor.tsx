import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Code2,
  Cpu,
  GitBranch,
  KeyRound,
  Loader2,
  Monitor,
  Play,
  RotateCcw,
  Send,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { analyzeHtml } from "@/lib/html";
import {
  applyPatchPlan,
  classifyInstruction,
  generatePatchPlan,
} from "@/lib/patchEngine";
import { validateChange } from "@/lib/validation";
import type { PatchPlan, ValidationResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type WorkspaceVersion = {
  _id: Id<"documentVersions">;
  versionNumber: number;
  parentVersionId?: Id<"documentVersions">;
  htmlStorageId: Id<"_storage">;
  htmlHash: string;
  htmlByteSize: number;
  htmlPreviewText?: string;
  htmlUrl?: string | null;
  instruction: string;
  route: string;
  structuralSummary: string;
  validationStatus: string;
  createdAt: number;
};

type WorkspaceDocument = {
  _id: Id<"documents">;
  title: string;
  currentVersionId?: Id<"documentVersions">;
};

type WorkspaceMessage = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type WorkspaceData = {
  document: WorkspaceDocument | null;
  versions: WorkspaceVersion[];
  messages: WorkspaceMessage[];
  runs: Array<{
    _id: string;
    route: string;
    status: string;
    instruction: string;
    startedAt: number;
  }>;
} | null;

type RunStatus =
  | "idle"
  | "classifying"
  | "patching"
  | "validating"
  | "saving"
  | "completed"
  | "failed";

type RunState = {
  status: RunStatus;
  route?: string;
  summary?: string;
  validation?: ValidationResult;
};

type Tab = "preview" | "source" | "diff" | "validation";
type Device = "desktop" | "tablet" | "mobile";

const sessionStorageKey = "pagewright.demoSession";
const MODEL_OPTIONS = [
  { id: "auto", label: "Auto · route by task" },
  { id: "anthropic:strong", label: "Claude Opus 4.8" },
  { id: "anthropic:cheap", label: "Claude Haiku 4.5" },
  { id: "openai:strong", label: "GPT-5.5" },
  { id: "openai:cheap", label: "GPT-5.4 nano" },
];
const emptyVersions: WorkspaceVersion[] = [];
const emptyMessages: WorkspaceMessage[] = [];
const sampleHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Northstar AI</title>
    <style>
      body { margin: 0; font-family: Georgia, serif; color: #172033; background: #fbfaf7; }
      header, section, footer { padding: 48px 7vw; }
      nav { display: flex; justify-content: space-between; align-items: center; }
      .hero { min-height: 420px; display: grid; align-content: center; gap: 18px; }
      h1 { max-width: 820px; font-size: 64px; line-height: 1; margin: 0; }
      .features, .testimonials { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
      .card { border: 1px solid #ddd6c8; border-radius: 14px; padding: 20px; background: #fff; }
      .cta a { color: #fff; background: #255f85; padding: 14px 18px; border-radius: 999px; text-decoration: none; }
      footer { color: #5f6875; border-top: 1px solid #ddd6c8; }
    </style>
  </head>
  <body>
    <header>
      <nav><strong>Northstar AI</strong><a href="#demo">Book demo</a></nav>
    </header>
    <main>
      <section class="hero">
        <p>Planning software for teams that move fast</p>
        <h1>Turn scattered customer conversations into a prioritized product roadmap</h1>
        <p>Northstar AI clusters feedback, finds revenue risk, and drafts roadmap updates for product leaders.</p>
      </section>
      <section class="features">
        <article class="card"><h2>Cluster feedback</h2><p>Group duplicate requests across calls, tickets, and notes.</p></article>
        <article class="card"><h2>Spot risk</h2><p>See which accounts are blocked by missing capabilities.</p></article>
        <article class="card"><h2>Write updates</h2><p>Draft release notes and roadmap summaries in seconds.</p></article>
      </section>
      <section class="testimonials">
        <blockquote class="card">"Northstar cut our planning meetings in half."</blockquote>
        <blockquote class="card">"The signal quality is much better than our old tags."</blockquote>
        <blockquote class="card">"It helps sales and product speak the same language."</blockquote>
      </section>
      <section class="cta" id="demo">
        <h2>Build your roadmap from real customer signal.</h2>
        <a href="mailto:hello@example.com">Book a demo</a>
      </section>
    </main>
    <footer>
      <p>Copyright 2026 Northstar AI. All rights reserved. Terms of service, privacy policy, security, support, newsletter, documentation, status, and contact information are available from this footer.</p>
    </footer>
  </body>
</html>`;

export function Editor() {
  const [session, setSession] = useState(() => readStoredSession());
  const workspace = useQuery(
    api.documents.getWorkspace,
    session ? { sessionToken: session.token } : "skip",
  ) as WorkspaceData | undefined;
  const createSession = useMutation(api.sessions.createSession);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createFromHtml = useMutation(api.documents.createFromHtml);
  const createEditVersion = useMutation(api.documents.createEditVersion);
  const revertVersion = useMutation(api.documents.revertVersion);
  const generateHtmlEdit = useAction(api.ai.generateHtmlEdit);

  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [importHtml, setImportHtml] = useState(sampleHtml);
  const [importTitle, setImportTitle] = useState("Northstar AI landing page");
  const [instruction, setInstruction] = useState("");
  const [selectedTab, setSelectedTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [manualModelId, setManualModelId] = useState("auto");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [activeHtml, setActiveHtml] = useState("");
  const [previousHtml, setPreviousHtml] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadedWorkspace = workspace ?? null;
  const versions = loadedWorkspace?.versions ?? emptyVersions;
  const messages = loadedWorkspace?.messages ?? emptyMessages;
  const document = workspace?.document ?? null;
  const activeVersionId = selectedVersionId ?? document?.currentVersionId ?? null;
  const currentVersion =
    versions.find((version) => version._id === activeVersionId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadVersionHtml(version: WorkspaceVersion | null) {
      if (!version) {
        setActiveHtml("");
        return;
      }
      if (version.htmlPreviewText) {
        setActiveHtml(version.htmlPreviewText);
        return;
      }
      if (version.htmlUrl) {
        const response = await fetch(version.htmlUrl);
        const text = await response.text();
        if (!cancelled) {
          setActiveHtml(text);
        }
      }
    }
    loadVersionHtml(currentVersion);
    return () => {
      cancelled = true;
    };
  }, [currentVersion]);

  async function handleUnlock(event: React.FormEvent) {
    event.preventDefault();
    if (!passcode.trim() || unlocking) return;
    setPasscodeError(null);
    setUnlocking(true);
    try {
      const clientToken = crypto.randomUUID();
      const result = await createSession({ passcode, clientToken });
      sessionStorage.setItem(sessionStorageKey, JSON.stringify(result));
      setSession(result);
    } catch (error) {
      setPasscodeError(errorToMessage(error));
      setUnlocking(false);
    }
  }

  async function uploadHtmlSnapshot(html: string, sourceFileName?: string) {
    if (!session) throw new Error("Missing session.");
    const postUrl = await generateUploadUrl({ sessionToken: session.token });
    const response = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: new Blob([html], { type: "text/html;charset=utf-8" }),
    });
    if (!response.ok) {
      throw new Error(`Upload failed with ${response.status}`);
    }
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    return { storageId, sourceFileName };
  }

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !importHtml.trim()) return;
    setRun({ status: "saving", summary: "Uploading and indexing initial HTML." });
    try {
      const analysis = analyzeHtml(importHtml);
      const { storageId, sourceFileName } = await uploadHtmlSnapshot(importHtml);
      await createFromHtml({
        sessionToken: session.token,
        title: importTitle || "Imported HTML page",
        sourceFileName,
        htmlStorageId: storageId,
        htmlText: importHtml,
        analysis,
      });
      setSelectedVersionId(null);
      setRun({ status: "completed", summary: "Imported HTML as v0." });
    } catch (error) {
      setRun({ status: "failed", summary: errorToMessage(error) });
    }
  }

  async function handleFileUpload(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setImportHtml(text);
    setImportTitle(file.name.replace(/\.html?$/i, "") || file.name);
  }

  async function handleInstruction(event?: React.FormEvent) {
    event?.preventDefault();
    if (!session || !document || !currentVersion || !activeHtml.trim() || !instruction.trim())
      return;

    const trimmedInstruction = instruction.trim();
    setPreviousHtml(activeHtml);
    setRun({ status: "classifying", summary: "Classifying instruction." });

    const decision = classifyInstruction(trimmedInstruction);
    if (decision.route === "revert") {
      await handleRevert();
      setInstruction("");
      return;
    }
    if (decision.route === "question_only") {
      setRun({
        status: "completed",
        route: decision.route,
        summary: "This was treated as a question, so no new version was created.",
      });
      return;
    }

    try {
      setRun({ status: "patching", route: decision.route, summary: decision.reasoningSummary });
      if (decision.modelCallNeeded) {
        const baseAnalysis = analyzeHtml(activeHtml);
        const providerEdit = await generateHtmlEdit({
          sessionToken: session.token,
          html: activeHtml,
          instruction: trimmedInstruction,
          structuralSummary: currentVersion.structuralSummary,
          brandSpec: baseAnalysis.brandSpec,
          contentInventory: baseAnalysis.contentInventory,
          manualModelId,
        });

        // Question-only: the router answered without producing a new version.
        if (providerEdit.isQuestion) {
          setInstruction("");
          setRun({
            status: "completed",
            route: providerEdit.route,
            summary: providerEdit.summary,
          });
          return;
        }

        const plan: PatchPlan = {
          route: providerEdit.route as PatchPlan["route"],
          confidence: decision.confidence,
          targetSections: providerEdit.targetSections as PatchPlan["targetSections"],
          allowedChangeScope: providerEdit.allowedChangeScope,
          modelCallNeeded: true,
          recommendedModelTier: providerEdit.tier === "strong" ? "strong" : "cheap",
          reasoningSummary: providerEdit.reasoning,
          operations: [],
        };
        const validation = validateChange(activeHtml, providerEdit.html, plan);
        setPreviousHtml(activeHtml);
        setSelectedTab("diff");
        const fallbackNote = providerEdit.fallbackUsed ? " · fallback" : "";
        const repairNote = providerEdit.repairUsed ? " · repaired" : "";
        setRun({
          status: "saving",
          route: providerEdit.route,
          summary: `${providerEdit.provider} · ${providerEdit.modelUsed}${fallbackNote}${repairNote}`,
          validation,
        });
        const analysis = analyzeHtml(providerEdit.html);
        const { storageId } = await uploadHtmlSnapshot(providerEdit.html);
        await createEditVersion({
          sessionToken: session.token,
          documentId: document._id,
          baseVersionId: currentVersion._id,
          htmlStorageId: storageId,
          htmlText: providerEdit.html,
          instruction: trimmedInstruction,
          route: providerEdit.route,
          targetSections: providerEdit.targetSections,
          allowedChangeScope: providerEdit.allowedChangeScope,
          patchOps: providerEdit.patchOps,
          validation,
          analysis,
          modelMeta: {
            provider: providerEdit.provider,
            modelUsed: providerEdit.modelUsed,
            tier: providerEdit.tier,
            fallbackUsed: providerEdit.fallbackUsed,
            repairUsed: providerEdit.repairUsed,
            modelCalls: providerEdit.modelCalls,
          },
        });
        setInstruction("");
        setSelectedVersionId(null);
        setRun({
          status: "completed",
          route: providerEdit.route,
          summary: `${providerEdit.summary} — ${providerEdit.provider} · ${providerEdit.modelUsed}${fallbackNote}${repairNote}`,
          validation,
        });
        return;
      }

      const plan = generatePatchPlan(activeHtml, trimmedInstruction);
      const patched = applyPatchPlan(activeHtml, plan);

      setRun({ status: "validating", route: plan.route, summary: "Running deterministic validators." });
      const validation = validateChange(activeHtml, patched.html, plan);
      if (patched.skipped.length > 0 && validation.status === "passed") {
        validation.status = "warning";
        validation.summary = "Some patch operations were skipped; review the diff.";
        validation.checks.push({
          name: "Patch application",
          status: "warning",
          detail: `${patched.skipped.length} operation(s) skipped.`,
        });
      }

      setSelectedTab("diff");
      setRun({ status: "saving", route: plan.route, summary: "Saving version snapshot.", validation });
      const analysis = analyzeHtml(patched.html);
      const { storageId } = await uploadHtmlSnapshot(patched.html);
      await createEditVersion({
        sessionToken: session.token,
        documentId: document._id,
        baseVersionId: currentVersion._id,
        htmlStorageId: storageId,
        htmlText: patched.html,
        instruction: trimmedInstruction,
        route: plan.route,
        targetSections: plan.targetSections,
        allowedChangeScope: plan.allowedChangeScope,
        patchOps: plan.operations,
        validation,
        analysis,
      });
      setInstruction("");
      setSelectedVersionId(null);
      setRun({
        status: "completed",
        route: plan.route,
        summary: `Saved ${plan.operations.length} patch operation(s).`,
        validation,
      });
    } catch (error) {
      setRun({ status: "failed", route: decision.route, summary: errorToMessage(error) });
    }
  }

  async function handleRevert(targetVersionId?: Id<"documentVersions">) {
    if (!session || !document) return;
    setRun({ status: "saving", route: "revert", summary: "Creating a new version from history." });
    try {
      await revertVersion({
        sessionToken: session.token,
        documentId: document._id,
        targetVersionId,
      });
      setSelectedVersionId(null);
      setSelectedTab("preview");
      setRun({ status: "completed", route: "revert", summary: "Revert saved as a new version." });
    } catch (error) {
      setRun({ status: "failed", route: "revert", summary: errorToMessage(error) });
    }
  }

  /* ---- Passcode gate ---- */
  if (!session) {
    return (
      <main className="grid min-h-svh grid-cols-1 bg-background lg:grid-cols-[1.1fr_0.9fr]">
        {/* Showcase */}
        <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border p-14 lg:flex">
          <div aria-hidden className="absolute inset-0">
            <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_75%_60%_at_28%_34%,#000,transparent_72%)]" />
            <div className="absolute -left-28 top-[26%] size-[360px] rounded-full bg-primary/[0.10] blur-[120px]" />
          </div>

          <span className="relative font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-foreground">
            Pagewright
          </span>

          <div className="relative max-w-md">
            <h2 className="text-[42px] font-semibold leading-[1.04] tracking-tight text-foreground">
              Edit any page by{" "}
              <span className="text-primary">describing the change.</span>
            </h2>

            <div className="mt-10 animate-[rise_0.7s_cubic-bezier(0.22,1,0.36,1)_0.1s_both] rounded-xl border border-border bg-card/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[13px] text-foreground/90">
                <span className="grid size-5 flex-none place-items-center rounded-md bg-primary/15 text-primary">
                  <Send className="size-3" />
                </span>
                make the CTA more prominent
              </div>
              <div className="mt-3 grid gap-1.5 font-mono text-[11px] leading-relaxed">
                <div className="rounded border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-destructive">
                  - &lt;a class="btn"&gt;Book demo&lt;/a&gt;
                </div>
                <div className="rounded border border-ok/20 bg-ok/10 px-2.5 py-1.5 text-ok">
                  + &lt;a class="btn btn--primary"&gt;Book a demo →&lt;/a&gt;
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 font-mono text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--amber-line)] bg-[var(--amber-dim)] px-2 py-0.5 text-primary">
                  v4 → v5
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-ok/25 bg-ok/10 px-2 py-0.5 text-ok">
                  <Check className="size-3" /> validated
                </span>
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-2 font-mono text-[11px] tracking-wide text-muted-foreground/70">
            <span>patch</span>
            <span className="text-primary/60">/</span>
            <span>validate</span>
            <span className="text-primary/60">/</span>
            <span>version</span>
          </div>
        </aside>

        {/* Form */}
        <section className="relative grid place-items-center px-6 py-12">
          <div className="w-full max-w-[348px] animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
            <span className="mb-9 block font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-foreground lg:hidden">
              Pagewright
            </span>

            <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
              Enter the editor
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Unlock with the shared demo passcode.
            </p>

            <form onSubmit={handleUnlock} className="mt-7 space-y-3">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  autoFocus
                  placeholder="Passcode"
                  aria-label="Passcode"
                  className="h-12 pl-10 font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal"
                />
              </div>
              {passcodeError && (
                <p className="flex animate-[rise_0.25s_ease_both] items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="size-4 shrink-0" /> {passcodeError}
                </p>
              )}
              <Button
                type="submit"
                disabled={unlocking}
                className="group h-12 w-full text-[15px] shadow-[0_12px_30px_-12px_var(--amber-glow)]"
              >
                {unlocking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Enter editor
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  /* ---- Loading ---- */
  if (workspace === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center gap-2.5 bg-background font-mono text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Connecting to Convex…
      </main>
    );
  }

  /* ---- Import step ---- */
  if (!document) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-7 [background-image:radial-gradient(120%_120%_at_50%_-10%,rgba(240,178,64,0.07),transparent_55%)]">
        <div className="w-full max-w-[680px] animate-[rise_0.5s_cubic-bezier(0.22,1,0.36,1)_both] rounded-xl border border-border bg-card p-8 shadow-2xl shadow-black/50">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
            Pagewright
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
            Load a page to begin
          </h1>
          <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
            Paste markup or upload an{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              .html
            </code>{" "}
            file. It's stored as <span className="font-mono text-foreground">v0</span>, then
            parsed, summarized, and brand-extracted before any edit runs.
          </p>
          <form onSubmit={handleImport} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-xs font-medium text-muted-foreground">
              Document title
              <Input
                value={importTitle}
                onChange={(event) => setImportTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-xs font-medium text-muted-foreground">
              HTML source
              <Textarea
                value={importHtml}
                onChange={(event) => setImportHtml(event.target.value)}
                spellCheck={false}
                className="min-h-[300px] resize-y bg-[var(--code)] font-mono text-xs leading-relaxed text-foreground/90"
              />
            </label>
            <div className="flex items-center justify-end gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,text/html"
                hidden
                onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" /> Upload .html
              </Button>
              <Button type="submit" disabled={run.status === "saving"}>
                {run.status === "saving" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Create v0
              </Button>
            </div>
            {run.status === "failed" && (
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" /> {run.summary}
              </p>
            )}
          </form>
        </div>
      </main>
    );
  }

  const viewingHistory =
    Boolean(selectedVersionId) && selectedVersionId !== document.currentVersionId;
  const orderedVersions = versions.slice().reverse();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid h-svh grid-rows-[auto_minmax(0,1fr)] bg-background">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card/60 px-4">
          <div className="flex min-w-0 items-center">
            <div className="min-w-0 leading-tight">
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Pagewright
              </span>
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {document.title}
              </h1>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <StatusPill status={run.status} />
            <span className="inline-flex h-7 items-center rounded-full border border-[var(--amber-line)] bg-[var(--amber-dim)] px-3 font-mono text-xs font-semibold text-primary">
              {currentVersion ? `v${currentVersion.versionNumber}` : "—"}
            </span>
          </div>
        </header>

        {/* Workspace */}
        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(330px,388px)_minmax(0,1fr)]">
          {/* Control rail */}
          <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-border bg-sidebar">
            <div className="grid content-start gap-5 overflow-auto p-4">
              {run.summary && run.status !== "idle" && (
                <p
                  className={cn(
                    "animate-[rise_0.3s_ease_both] rounded-md border-l-2 bg-muted px-3 py-2.5 text-[12.5px] leading-snug",
                    run.status === "failed"
                      ? "border-destructive text-destructive"
                      : run.status === "completed"
                        ? "border-ok text-foreground/85"
                        : "border-primary text-foreground/85",
                  )}
                >
                  {run.summary}
                </p>
              )}

              <section className="grid gap-3">
                <SectionLabel icon={<GitBranch className="size-3.5" />}>
                  Version graph
                </SectionLabel>
                <div className="relative pl-[26px]">
                  <span className="absolute bottom-3 left-[9px] top-3 w-px bg-border" />
                  {orderedVersions.map((version) => {
                    const isCurrent = version._id === document.currentVersionId;
                    const isSelected = version._id === selectedVersionId;
                    return (
                      <div key={version._id} className="relative pb-2">
                        <span
                          className={cn(
                            "absolute -left-[21px] top-[15px] size-2.5 rounded-full ring-4 ring-sidebar",
                            isCurrent
                              ? "bg-primary shadow-[0_0_10px_0_var(--amber-glow)]"
                              : "border border-border bg-muted",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedVersionId(isCurrent ? null : version._id)
                          }
                          className={cn(
                            "block w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                            isCurrent
                              ? "border-[var(--amber-line)] bg-[var(--amber-dim)]"
                              : "border-border bg-card hover:border-input hover:bg-accent",
                            isSelected && "ring-2 ring-ring/70",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "font-mono text-xs font-semibold",
                                isCurrent ? "text-primary" : "text-foreground",
                              )}
                            >
                              v{version.versionNumber}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                              {version.route}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {version.instruction}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/70">
                            <span>{formatBytes(version.htmlByteSize)}</span>
                            <span>·</span>
                            <span>{version.htmlHash.slice(0, 7)}</span>
                          </div>
                          {!isCurrent && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRevert(version._id);
                              }}
                              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <RotateCcw className="size-3" /> Revert here
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {messages.length > 0 && (
                <section className="grid gap-3">
                  <SectionLabel icon={<Send className="size-3.5" />}>
                    Activity
                  </SectionLabel>
                  <div className="grid gap-2">
                    {messages.map((message) => (
                      <div
                        key={message._id}
                        className={cn(
                          "grid gap-1 rounded-md border-l-2 bg-card px-3 py-2.5",
                          message.role === "assistant"
                            ? "border-primary"
                            : message.role === "user"
                              ? "border-foreground/40"
                              : "border-border",
                        )}
                      >
                        <strong className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {message.role}
                        </strong>
                        <span className="text-[13px] leading-snug text-foreground/85 [overflow-wrap:anywhere]">
                          {message.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={handleInstruction}
              className="grid gap-2.5 border-t border-border bg-card/50 p-4"
            >
              <Textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Describe a change — shorten the footer, change the background to light blue, make the CTA more prominent…"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    handleInstruction();
                  }
                }}
                className="min-h-[88px] resize-y"
              />
              <div className="flex items-center justify-between gap-2.5">
                <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/70">
                  <Cpu className="size-3.5" />
                  <select
                    value={manualModelId}
                    onChange={(event) => setManualModelId(event.target.value)}
                    aria-label="Model"
                    className="cursor-pointer rounded-md border border-input bg-background px-2 py-1 font-sans text-[11px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="submit"
                  disabled={!instruction.trim() || isRunning(run.status)}
                >
                  {isRunning(run.status) ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Run edit
                </Button>
              </div>
            </form>
          </aside>

          {/* Canvas */}
          <section className="flex min-h-0 min-w-0 flex-col gap-3 p-3.5">
            <div className="flex flex-none items-center justify-between gap-3">
              <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as Tab)}>
                <TabsList>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="source">
                    <Code2 className="size-3.5" /> Source
                  </TabsTrigger>
                  <TabsTrigger value="diff">Diff</TabsTrigger>
                  <TabsTrigger value="validation">
                    <Check className="size-3.5" /> Validation
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {selectedTab === "preview" && (
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                  {(
                    [
                      ["desktop", Monitor, "Desktop"],
                      ["tablet", Tablet, "Tablet"],
                      ["mobile", Smartphone, "Mobile"],
                    ] as const
                  ).map(([key, Icon, label]) => (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setDevice(key)}
                          className={cn(
                            "grid size-8 place-items-center rounded-md transition-colors",
                            device === key
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>

            {viewingHistory && currentVersion && (
              <div className="flex flex-none animate-[rise_0.3s_ease_both] items-center justify-between gap-3 rounded-md border border-[var(--amber-line)] bg-[var(--amber-dim)] px-3.5 py-2 text-[12.5px] text-primary">
                <span>
                  Viewing <b className="font-mono">v{currentVersion.versionNumber}</b> from
                  history — read-only.
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedVersionId(null)}
                  className="font-semibold underline underline-offset-2"
                >
                  Back to current
                </button>
              </div>
            )}

            <div className="flex min-h-0 flex-1">
              {selectedTab === "preview" && (
                <div className="grid flex-1 items-stretch justify-items-center overflow-auto rounded-xl border border-border bg-[var(--code)] p-5 [background-image:radial-gradient(circle_at_center,rgba(236,230,210,0.05)_1px,transparent_1px)] [background-size:18px_18px]">
                  {activeHtml ? (
                    <iframe
                      title="Sandboxed HTML preview"
                      sandbox=""
                      srcDoc={activeHtml}
                      className={cn(
                        "min-h-full w-full rounded-lg border border-border bg-white shadow-2xl shadow-black/50 transition-[max-width] duration-300",
                        device === "tablet" && "max-w-[834px]",
                        device === "mobile" && "max-w-[390px]",
                      )}
                    />
                  ) : (
                    <p className="self-center text-sm text-muted-foreground">
                      Loading the sandboxed preview…
                    </p>
                  )}
                </div>
              )}

              {selectedTab === "source" && (
                <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-[var(--code)] p-[18px] font-mono text-xs leading-relaxed text-foreground/90">
                  {activeHtml || "No source loaded."}
                </pre>
              )}

              {selectedTab === "diff" && (
                <div className="flex-1 overflow-auto rounded-xl border border-border bg-card p-[18px]">
                  {previousHtml && activeHtml ? (
                    <Diff before={previousHtml} after={activeHtml} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Run an edit to see a before/after source diff.
                    </p>
                  )}
                </div>
              )}

              {selectedTab === "validation" && (
                <div className="grid flex-1 content-start gap-2.5 overflow-auto rounded-xl border border-border bg-card p-[18px]">
                  {run.validation ? (
                    <>
                      <div
                        className={cn(
                          "grid grid-cols-[auto_1fr] items-center gap-2.5 rounded-md border px-3.5 py-3 text-sm font-semibold",
                          validationTone(run.validation.status),
                        )}
                      >
                        {run.validation.status === "failed" ? (
                          <AlertTriangle className="size-[18px]" />
                        ) : (
                          <Check className="size-[18px]" />
                        )}
                        <span>{run.validation.summary}</span>
                      </div>
                      {run.validation.checks.map((check) => (
                        <div
                          key={`${check.name}-${check.detail}`}
                          className="grid grid-cols-[auto_1fr] gap-2.5 rounded-md border border-border bg-background/40 px-3.5 py-3"
                        >
                          <span className={checkTone(check.status)}>
                            {check.status === "passed" ? (
                              <Check className="mt-0.5 size-4" />
                            ) : (
                              <AlertTriangle className="mt-0.5 size-4" />
                            )}
                          </span>
                          <div>
                            <strong className="block text-[13px] font-semibold text-foreground">
                              {check.name}
                            </strong>
                            <span className="text-xs leading-snug text-muted-foreground">
                              {check.detail}
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Validation results appear after an edit run.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  const active = isRunning(status);
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border px-3 font-mono text-[11px] font-semibold uppercase tracking-wide",
        status === "failed"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-foreground/80",
      )}
    >
      <span className="relative flex size-2">
        {active && (
          <span className="absolute inline-flex size-full animate-[ping-amber_1.4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-warn" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "failed"
              ? "bg-destructive"
              : status === "completed" || status === "idle"
                ? "bg-ok"
                : "bg-warn",
          )}
        />
      </span>
      {status === "idle" ? "Ready" : status}
    </span>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const rows = Array.from({ length: max }, (_, index) => ({
    before: beforeLines[index] ?? "",
    after: afterLines[index] ?? "",
  })).filter((row) => row.before !== row.after);

  return (
    <div className="grid gap-2">
      {rows.slice(0, 120).map((row, index) => (
        <div
          key={`${index}-${row.before}-${row.after}`}
          className="grid grid-cols-2 gap-2"
        >
          <pre className="m-0 whitespace-pre-wrap break-words rounded border border-destructive/25 bg-destructive/10 px-2.5 py-2 font-mono text-[11px] leading-snug text-destructive">
            - {row.before}
          </pre>
          <pre className="m-0 whitespace-pre-wrap break-words rounded border border-ok/25 bg-ok/10 px-2.5 py-2 font-mono text-[11px] leading-snug text-ok">
            + {row.after}
          </pre>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No line-level changes.</p>
      )}
      {rows.length > 120 && (
        <p className="text-sm text-muted-foreground">Showing first 120 changed lines.</p>
      )}
    </div>
  );
}

function validationTone(status: ValidationResult["status"]) {
  if (status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "warning") return "border-warn/30 bg-warn/10 text-warn";
  return "border-ok/30 bg-ok/10 text-ok";
}

function checkTone(status: string) {
  if (status === "passed") return "text-ok";
  if (status === "warning") return "text-warn";
  return "text-destructive";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readStoredSession(): { token: string; expiresAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(sessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (!parsed.token || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(sessionStorageKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isRunning(status: RunStatus) {
  return ["classifying", "patching", "validating", "saving"].includes(status);
}

function errorToMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The operation failed.";
}
