import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  FileUp,
  History,
  Loader2,
  Monitor,
  Play,
  RotateCcw,
  Send,
  Shield,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import "./App.css";
import { analyzeHtml } from "./lib/html";
import { applyPatchPlan, classifyInstruction, generatePatchPlan } from "./lib/patchEngine";
import { validateChange } from "./lib/validation";
import type { PatchPlan, ValidationResult } from "./lib/types";

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

type RunState = {
  status:
    | "idle"
    | "classifying"
    | "patching"
    | "validating"
    | "saving"
    | "completed"
    | "failed";
  route?: string;
  summary?: string;
  validation?: ValidationResult;
};

const sessionStorageKey = "pagewright.demoSession";
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

export default function App() {
  const [session, setSession] = useState(() => readStoredSession());
  const workspace = useQuery(api.documents.getWorkspace, session ? { sessionToken: session.token } : "skip") as
    | WorkspaceData
    | undefined;
  const createSession = useMutation(api.sessions.createSession);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createFromHtml = useMutation(api.documents.createFromHtml);
  const createEditVersion = useMutation(api.documents.createEditVersion);
  const revertVersion = useMutation(api.documents.revertVersion);
  const generateHtmlEdit = useAction(api.ai.generateHtmlEdit);

  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [importHtml, setImportHtml] = useState(sampleHtml);
  const [importTitle, setImportTitle] = useState("Northstar AI landing page");
  const [instruction, setInstruction] = useState("");
  const [selectedTab, setSelectedTab] = useState<"preview" | "source" | "diff" | "validation">("preview");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [activeHtml, setActiveHtml] = useState("");
  const [previousHtml, setPreviousHtml] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadedWorkspace = workspace ?? null;
  const versions = loadedWorkspace?.versions ?? emptyVersions;
  const messages = loadedWorkspace?.messages ?? emptyMessages;
  const document = workspace?.document ?? null;
  const currentVersion = useMemo(() => {
    if (selectedVersionId) {
      return versions.find((version) => version._id === selectedVersionId) ?? null;
    }
    if (!document?.currentVersionId) return null;
    return versions.find((version) => version._id === document.currentVersionId) ?? null;
  }, [document?.currentVersionId, selectedVersionId, versions]);

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
    setPasscodeError(null);
    try {
      const clientToken = crypto.randomUUID();
      const result = await createSession({ passcode, clientToken });
      setSession(result);
      sessionStorage.setItem(sessionStorageKey, JSON.stringify(result));
    } catch (error) {
      setPasscodeError(errorToMessage(error));
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
    if (!session || !document || !currentVersion || !activeHtml.trim() || !instruction.trim()) return;

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
      setRun({ status: "completed", route: decision.route, summary: "This was treated as a question, so no new version was created." });
      return;
    }

    try {
      setRun({ status: "patching", route: decision.route, summary: decision.reasoningSummary });
      if (decision.modelCallNeeded) {
        const providerEdit = await generateHtmlEdit({
          sessionToken: session.token,
          html: activeHtml,
          instruction: trimmedInstruction,
          structuralSummary: currentVersion.structuralSummary,
        });
        const plan: PatchPlan = {
          route: providerEdit.route as PatchPlan["route"],
          confidence: decision.confidence,
          targetSections: providerEdit.targetSections as PatchPlan["targetSections"],
          allowedChangeScope: providerEdit.allowedChangeScope,
          modelCallNeeded: true,
          recommendedModelTier: "strong",
          reasoningSummary: providerEdit.summary,
          operations: [],
        };
        const validation = validateChange(activeHtml, providerEdit.html, plan);
        setPreviousHtml(activeHtml);
        setSelectedTab("diff");
        setRun({
          status: "saving",
          route: providerEdit.route,
          summary: `Saving ${providerEdit.provider} / ${providerEdit.modelUsed} output.`,
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
        });
        setInstruction("");
        setSelectedVersionId(null);
        setRun({
          status: "completed",
          route: providerEdit.route,
          summary: providerEdit.summary,
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

  if (!session) {
    return (
      <main className="gate">
        <form className="gate-panel" onSubmit={handleUnlock}>
          <div className="mark"><Shield size={24} /></div>
          <p className="eyebrow">Pagewright demo</p>
          <h1>Natural-language HTML editing, behind a passcode.</h1>
          <p className="muted">The passcode is checked in Convex. Provider keys and uploaded HTML stay out of the client bundle.</p>
          <label>
            Demo passcode
            <input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoFocus
              placeholder="Enter passcode"
            />
          </label>
          {passcodeError && <p className="error-line">{passcodeError}</p>}
          <button className="primary-action" type="submit">
            <ArrowLeft size={16} /> Unlock editor
          </button>
        </form>
      </main>
    );
  }

  if (workspace === undefined) {
    return (
      <main className="loading-shell">
        <Loader2 className="spin" /> Connecting to Convex
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <section className="left-pane">
        <header className="app-header">
          <div>
            <p className="eyebrow">Pagewright</p>
            <h1>{document?.title ?? "Import HTML"}</h1>
          </div>
          <div className="version-badge">{currentVersion ? `v${currentVersion.versionNumber}` : "No doc"}</div>
        </header>

        {!document ? (
          <form className="import-panel" onSubmit={handleImport}>
            <div className="section-heading">
              <FileUp size={18} />
              <span>Initial HTML</span>
            </div>
            <label>
              Document title
              <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} />
            </label>
            <textarea value={importHtml} onChange={(event) => setImportHtml(event.target.value)} spellCheck={false} />
            <div className="import-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,text/html"
                hidden
                onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
              />
              <button type="button" className="secondary-action" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} /> Upload .html
              </button>
              <button type="submit" className="primary-action" disabled={run.status === "saving"}>
                {run.status === "saving" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                Create v0
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="run-card">
              <div className={`status-dot ${run.status}`} />
              <div>
                <strong>{run.status === "idle" ? "Ready" : run.status}</strong>
                <p>{run.summary ?? "Enter an instruction to create the next version."}</p>
              </div>
            </div>

            <form className="composer" onSubmit={handleInstruction}>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Try: shorten the footer, change the background to light blue, remove testimonials, make the CTA button more prominent"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    handleInstruction();
                  }
                }}
              />
              <button className="primary-action" type="submit" disabled={!instruction.trim() || isRunning(run.status)}>
                {isRunning(run.status) ? <Loader2 className="spin" size={16} /> : <Send size={16} />} Run edit
              </button>
            </form>

            <div className="timeline">
              <div className="section-heading">
                <History size={18} />
                <span>Versions</span>
              </div>
              {versions
                .slice()
                .reverse()
                .map((version) => (
                  <button
                    key={version._id}
                    className={`timeline-row ${
                      version._id === document.currentVersionId ? "active" : ""
                    } ${version._id === selectedVersionId ? "selected" : ""}`}
                    onClick={() =>
                      setSelectedVersionId(version._id === document.currentVersionId ? null : version._id)
                    }
                    type="button"
                  >
                    <span>v{version.versionNumber}</span>
                    <small>{version.route}</small>
                    <em>{version.instruction}</em>
                    {version._id !== document.currentVersionId && (
                      <span
                        className="inline-revert"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRevert(version._id);
                        }}
                      >
                        <RotateCcw size={13} /> Revert
                      </span>
                    )}
                  </button>
                ))}
            </div>

            <div className="messages">
              {messages.slice(-5).map((message) => (
                <div className={`message ${message.role}`} key={message._id}>
                  <strong>{message.role}</strong>
                  <span>{message.content}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="right-pane">
        <div className="toolbar">
          <div className="tabs">
            {(["preview", "source", "diff", "validation"] as const).map((tab) => (
              <button
                key={tab}
                className={selectedTab === tab ? "selected" : ""}
                onClick={() => setSelectedTab(tab)}
                type="button"
              >
                {tab === "source" ? <Code2 size={15} /> : tab === "validation" ? <Check size={15} /> : null}
                {tab}
              </button>
            ))}
          </div>
          <div className="devices">
            <button className={device === "desktop" ? "selected" : ""} onClick={() => setDevice("desktop")} type="button">
              <Monitor size={16} />
            </button>
            <button className={device === "tablet" ? "selected" : ""} onClick={() => setDevice("tablet")} type="button">
              <Tablet size={16} />
            </button>
            <button className={device === "mobile" ? "selected" : ""} onClick={() => setDevice("mobile")} type="button">
              <Smartphone size={16} />
            </button>
          </div>
        </div>

        {selectedTab === "preview" && (
          <div className={`preview-stage ${device}`}>
            {activeHtml ? (
              <iframe title="Sandboxed HTML preview" sandbox="" srcDoc={activeHtml} />
            ) : (
              <div className="empty-preview">Import HTML to render a sandboxed preview.</div>
            )}
          </div>
        )}

        {selectedTab === "source" && <pre className="source-view">{activeHtml || "No source loaded."}</pre>}

        {selectedTab === "diff" && (
          <div className="diff-view">
            {previousHtml && activeHtml ? (
              <Diff before={previousHtml} after={activeHtml} />
            ) : (
              <p className="muted">Run an edit to see a before/after source diff.</p>
            )}
          </div>
        )}

        {selectedTab === "validation" && (
          <div className="validation-view">
            {run.validation ? (
              <>
                <div className={`validation-summary ${run.validation.status}`}>
                  {run.validation.status === "failed" ? <AlertTriangle size={18} /> : <Check size={18} />}
                  <span>{run.validation.summary}</span>
                </div>
                {run.validation.checks.map((check) => (
                  <div className={`check ${check.status}`} key={`${check.name}-${check.detail}`}>
                    <strong>{check.name}</strong>
                    <span>{check.detail}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="muted">Validation results appear after an edit run.</p>
            )}
          </div>
        )}
      </section>
    </main>
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
    <div className="diff-grid">
      {rows.slice(0, 120).map((row, index) => (
        <div className="diff-row" key={`${index}-${row.before}-${row.after}`}>
          <pre className="removed">- {row.before}</pre>
          <pre className="added">+ {row.after}</pre>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">No line-level changes.</p>}
      {rows.length > 120 && <p className="muted">Showing first 120 changed lines.</p>}
    </div>
  );
}

function readStoredSession(): { token: string; expiresAt: number } | null {
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

function isRunning(status: RunState["status"]) {
  return ["classifying", "patching", "validating", "saving"].includes(status);
}

function errorToMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The operation failed.";
}
