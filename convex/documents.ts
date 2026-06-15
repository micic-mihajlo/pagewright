import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSession, touchSession } from "./sessions";

const previewLimit = 180_000;

export const generateUploadUrl = mutation({
  args: { sessionToken: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await touchSession(ctx, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getWorkspace = query({
  args: { sessionToken: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionToken);

    const project = await getDefaultProject(ctx);
    if (!project) {
      return null;
    }

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .order("desc")
      .collect();
    const document = documents[0] ?? null;
    if (!document) {
      return { project, document: null, versions: [], messages: [], runs: [] };
    }

    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .order("asc")
      .collect();
    const versionsWithUrls = await Promise.all(
      versions.map(async (version) => ({
        ...version,
        htmlUrl: await ctx.storage.getUrl(version.htmlStorageId),
      })),
    );

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .order("asc")
      .collect();
    const runs = await ctx.db
      .query("editRuns")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .order("desc")
      .take(12);

    return { project, document, versions: versionsWithUrls, messages, runs };
  },
});

export const createFromHtml = mutation({
  args: {
    sessionToken: v.string(),
    title: v.string(),
    sourceFileName: v.optional(v.string()),
    htmlStorageId: v.id("_storage"),
    htmlText: v.string(),
    analysis: v.any(),
  },
  returns: v.object({
    documentId: v.id("documents"),
    versionId: v.id("documentVersions"),
  }),
  handler: async (ctx, args) => {
    await touchSession(ctx, args.sessionToken);
    const now = Date.now();
    const project = await ensureDefaultProject(ctx, now);

    const documentId = await ctx.db.insert("documents", {
      projectId: project._id,
      title: args.title || args.sourceFileName || "Untitled HTML page",
      createdAt: now,
      updatedAt: now,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      documentId,
      versionNumber: 0,
      htmlStorageId: args.htmlStorageId,
      htmlHash: args.analysis.htmlHash,
      htmlByteSize: args.analysis.byteSize,
      htmlPreviewText: args.htmlText.length <= previewLimit ? args.htmlText : undefined,
      instruction: "Initial HTML import",
      route: "initial_import",
      timestamp: now,
      structuralSummary: args.analysis.structuralSummary,
      brandSpec: args.analysis.brandSpec,
      contentInventory: args.analysis.contentInventory,
      sectionIndexStatus: "indexed",
      validationStatus: "passed",
      createdAt: now,
    });

    await ctx.db.patch(documentId, { currentVersionId: versionId, updatedAt: now });
    await ctx.db.insert("chatMessages", {
      documentId,
      versionId,
      role: "system",
      content: `Imported ${args.sourceFileName || "pasted HTML"} as v0.`,
      createdAt: now,
    });
    await insertSectionIndex(ctx, versionId, args.analysis);

    return { documentId, versionId };
  },
});

export const createEditVersion = mutation({
  args: {
    sessionToken: v.string(),
    documentId: v.id("documents"),
    baseVersionId: v.id("documentVersions"),
    htmlStorageId: v.id("_storage"),
    htmlText: v.string(),
    instruction: v.string(),
    route: v.string(),
    targetSections: v.array(v.string()),
    allowedChangeScope: v.string(),
    patchOps: v.array(v.any()),
    validation: v.any(),
    analysis: v.any(),
    modelMeta: v.optional(v.any()),
  },
  returns: v.object({
    versionId: v.id("documentVersions"),
    editRunId: v.id("editRuns"),
  }),
  handler: async (ctx, args) => {
    await touchSession(ctx, args.sessionToken);
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }
    if (document.currentVersionId !== args.baseVersionId) {
      throw new ConvexError({
        code: "STALE_BASE_VERSION",
        message: "The document changed while this edit was running. Retry from the latest version.",
      });
    }

    const now = Date.now();
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const nextVersionNumber =
      versions.reduce((max, version) => Math.max(max, version.versionNumber), -1) + 1;

    const meta = (args.modelMeta ?? null) as {
      provider?: string;
      modelUsed?: string;
      tier?: string;
      fallbackUsed?: boolean;
      repairUsed?: boolean;
      modelCalls?: Array<Record<string, unknown>>;
    } | null;
    const usedModel = Boolean(meta?.modelUsed);

    const editRunId = await ctx.db.insert("editRuns", {
      documentId: args.documentId,
      baseVersionId: args.baseVersionId,
      instruction: args.instruction,
      route: args.route,
      status: args.validation.status === "failed" ? "failed" : "completed",
      targetSections: args.targetSections,
      allowedChangeScope: args.allowedChangeScope,
      modelPolicy: usedModel
        ? {
            modelCallNeeded: true,
            tier: meta?.tier ?? "unknown",
            repairUsed: Boolean(meta?.repairUsed),
            implementation: "provider_abstraction",
          }
        : { modelCallNeeded: false, implementation: "deterministic_patch_engine" },
      modelUsed: meta?.modelUsed,
      fallbackUsed: Boolean(meta?.fallbackUsed),
      startedAt: now,
      completedAt: now,
      error: args.validation.status === "failed" ? args.validation.summary : undefined,
    });

    await insertModelCalls(ctx, editRunId, meta?.modelCalls, now);

    if (args.validation.status === "failed") {
      await insertPatchOps(ctx, editRunId, args.patchOps, false);
      await ctx.db.insert("validationResults", {
        editRunId,
        validator: "mvp_validation",
        status: "failed",
        details: args.validation,
        createdAt: now,
      });
      await ctx.db.insert("chatMessages", {
        documentId: args.documentId,
        editRunId,
        role: "system",
        content: args.validation.summary,
        createdAt: now,
      });
      throw new ConvexError({ code: "VALIDATION_FAILED", message: args.validation.summary });
    }

    const versionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      versionNumber: nextVersionNumber,
      parentVersionId: args.baseVersionId,
      htmlStorageId: args.htmlStorageId,
      htmlHash: args.analysis.htmlHash,
      htmlByteSize: args.analysis.byteSize,
      htmlPreviewText: args.htmlText.length <= previewLimit ? args.htmlText : undefined,
      instruction: args.instruction,
      route: args.route,
      timestamp: now,
      structuralSummary: args.analysis.structuralSummary,
      brandSpec: args.analysis.brandSpec,
      contentInventory: args.analysis.contentInventory,
      sectionIndexStatus: "indexed",
      validationStatus: args.validation.status,
      createdByRunId: editRunId,
      createdAt: now,
    });

    await ctx.db.patch(editRunId, { outputVersionId: versionId });
    await ctx.db.patch(args.documentId, { currentVersionId: versionId, updatedAt: now });
    await insertPatchOps(ctx, editRunId, args.patchOps, true);
    await insertSectionIndex(ctx, versionId, args.analysis);
    await ctx.db.insert("validationResults", {
      editRunId,
      versionId,
      validator: "mvp_validation",
      status: args.validation.status,
      details: args.validation,
      createdAt: now,
    });
    await ctx.db.insert("chatMessages", {
      documentId: args.documentId,
      versionId,
      editRunId,
      role: "user",
      content: args.instruction,
      createdAt: now,
    });
    const modelNote = usedModel
      ? ` · ${meta?.provider ?? "model"} · ${meta?.modelUsed ?? ""} (${meta?.tier ?? "tier"})${
          meta?.fallbackUsed ? " · fallback" : ""
        }${meta?.repairUsed ? " · repaired" : ""}`
      : " · deterministic patch (no model)";
    await ctx.db.insert("chatMessages", {
      documentId: args.documentId,
      versionId,
      editRunId,
      role: "assistant",
      content: `Saved as v${nextVersionNumber}. ${args.validation.summary}${modelNote}`,
      createdAt: now + 1,
    });

    return { versionId, editRunId };
  },
});

export const revertVersion = mutation({
  args: {
    sessionToken: v.string(),
    documentId: v.id("documents"),
    targetVersionId: v.optional(v.id("documentVersions")),
  },
  returns: v.object({
    versionId: v.id("documentVersions"),
  }),
  handler: async (ctx, args) => {
    await touchSession(ctx, args.sessionToken);
    const document = await ctx.db.get(args.documentId);
    if (!document?.currentVersionId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document not found." });
    }

    const current = await ctx.db.get(document.currentVersionId);
    if (!current) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Current version not found." });
    }

    const targetVersionId = args.targetVersionId ?? current.parentVersionId;
    if (!targetVersionId) {
      throw new ConvexError({ code: "NO_PREVIOUS_VERSION", message: "There is no previous version." });
    }

    const target = await ctx.db.get(targetVersionId);
    if (!target || target.documentId !== args.documentId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Target version not found." });
    }

    const now = Date.now();
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const nextVersionNumber =
      versions.reduce((max, version) => Math.max(max, version.versionNumber), -1) + 1;

    const runId = await ctx.db.insert("editRuns", {
      documentId: args.documentId,
      baseVersionId: current._id,
      outputVersionId: undefined,
      instruction: `Revert to v${target.versionNumber}`,
      route: "revert",
      status: "completed",
      targetSections: [],
      allowedChangeScope: "version history only",
      modelPolicy: { modelCallNeeded: false },
      fallbackUsed: false,
      startedAt: now,
      completedAt: now,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      versionNumber: nextVersionNumber,
      parentVersionId: current._id,
      htmlStorageId: target.htmlStorageId,
      htmlHash: target.htmlHash,
      htmlByteSize: target.htmlByteSize,
      htmlPreviewText: target.htmlPreviewText,
      instruction: `Revert to v${target.versionNumber}`,
      route: "revert",
      timestamp: now,
      structuralSummary: target.structuralSummary,
      brandSpec: target.brandSpec,
      contentInventory: target.contentInventory,
      sectionIndexStatus: target.sectionIndexStatus,
      validationStatus: "passed",
      createdByRunId: runId,
      createdAt: now,
    });

    await ctx.db.patch(runId, { outputVersionId: versionId });
    await ctx.db.patch(args.documentId, { currentVersionId: versionId, updatedAt: now });
    await ctx.db.insert("chatMessages", {
      documentId: args.documentId,
      versionId,
      editRunId: runId,
      role: "system",
      content: `Reverted to v${target.versionNumber}; saved as v${nextVersionNumber}.`,
      createdAt: now,
    });

    return { versionId };
  },
});

async function getDefaultProject(ctx: QueryCtx) {
  return await ctx.db.query("projects").first();
}

async function ensureDefaultProject(ctx: MutationCtx, now: number) {
  const existing = await ctx.db.query("projects").first();
  if (existing) {
    return existing;
  }
  const projectId = await ctx.db.insert("projects", {
    name: "Default demo workspace",
    createdAt: now,
    updatedAt: now,
  });
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new ConvexError({ code: "PROJECT_CREATE_FAILED", message: "Could not create project." });
  }
  return project;
}

async function insertPatchOps(
  ctx: MutationCtx,
  editRunId: Id<"editRuns">,
  patchOps: Array<Record<string, unknown>>,
  applied: boolean,
) {
  await Promise.all(
    patchOps.map((operation, index) =>
      ctx.db.insert("patchOps", {
        editRunId,
        opIndex: index,
        operation: String(operation.operation ?? "unknown"),
        target: String(operation.selector ?? "unknown"),
        beforeHash: typeof operation.beforeHash === "string" ? operation.beforeHash : undefined,
        payload: operation.payload ?? {},
        reason: String(operation.reason ?? ""),
        expectedScope: String(operation.expectedScope ?? ""),
        riskLevel: String(operation.riskLevel ?? "low"),
        applied,
      }),
    ),
  );
}

async function insertModelCalls(
  ctx: MutationCtx,
  editRunId: Id<"editRuns">,
  modelCalls: Array<Record<string, unknown>> | undefined,
  now: number,
) {
  if (!Array.isArray(modelCalls) || modelCalls.length === 0) return;
  await Promise.all(
    modelCalls.map((call, index) =>
      ctx.db.insert("modelCalls", {
        editRunId,
        task: String(call.task ?? "unknown"),
        provider: `${String(call.vendor ?? "unknown")} (${String(call.transport ?? "unknown")})`,
        model: String(call.model ?? "unknown"),
        inputTokenEstimate: 0,
        outputTokenEstimate: 0,
        latencyMs: Number(call.latencyMs ?? 0),
        status: String(call.status ?? "unknown"),
        error: typeof call.error === "string" ? call.error : undefined,
        createdAt: now + index,
      }),
    ),
  );
}

async function insertSectionIndex(
  ctx: MutationCtx,
  versionId: Id<"documentVersions">,
  analysis: Record<string, unknown>,
) {
  const sections = Array.isArray(analysis.sections)
    ? (analysis.sections as Array<Record<string, unknown>>)
    : [];
  await Promise.all(
    sections.map((section) =>
      ctx.db.insert("sectionIndex", {
        versionId,
        nodeId: String(section.id ?? "unknown"),
        sectionType: String(section.type ?? "unknown"),
        domPath: String(section.selector ?? ""),
        headingText: typeof section.label === "string" ? section.label : undefined,
        textSummary: String(section.textSummary ?? ""),
        htmlExcerpt: String(section.textSummary ?? ""),
        cssRefs: [],
        contentHash: String(section.htmlHash ?? ""),
        tokenEstimate: Math.ceil(Number(section.byteSize ?? 0) / 4),
      }),
    ),
  );
}
