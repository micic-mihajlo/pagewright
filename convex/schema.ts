import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  demoSessions: defineTable({
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.number(),
  }).index("by_tokenHash", ["tokenHash"]),

  projects: defineTable({
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  documents: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    currentVersionId: v.optional(v.id("documentVersions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_updated", ["updatedAt"]),

  documentVersions: defineTable({
    documentId: v.id("documents"),
    versionNumber: v.number(),
    parentVersionId: v.optional(v.id("documentVersions")),
    htmlStorageId: v.id("_storage"),
    htmlHash: v.string(),
    htmlByteSize: v.number(),
    htmlPreviewText: v.optional(v.string()),
    instruction: v.string(),
    route: v.string(),
    timestamp: v.number(),
    structuralSummary: v.string(),
    brandSpec: v.any(),
    contentInventory: v.any(),
    sectionIndexStatus: v.string(),
    validationStatus: v.string(),
    screenshotStorageId: v.optional(v.id("_storage")),
    createdByRunId: v.optional(v.id("editRuns")),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId", "versionNumber"])
    .index("by_document_created", ["documentId", "createdAt"]),

  chatMessages: defineTable({
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    editRunId: v.optional(v.id("editRuns")),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_document", ["documentId", "createdAt"]),

  editRuns: defineTable({
    documentId: v.id("documents"),
    baseVersionId: v.id("documentVersions"),
    outputVersionId: v.optional(v.id("documentVersions")),
    instruction: v.string(),
    route: v.string(),
    status: v.string(),
    targetSections: v.array(v.string()),
    allowedChangeScope: v.string(),
    modelPolicy: v.any(),
    modelUsed: v.optional(v.string()),
    fallbackUsed: v.boolean(),
    tokenUsage: v.optional(v.any()),
    costEstimate: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_document", ["documentId", "startedAt"]),

  patchOps: defineTable({
    editRunId: v.id("editRuns"),
    opIndex: v.number(),
    operation: v.string(),
    target: v.string(),
    beforeHash: v.optional(v.string()),
    payload: v.any(),
    reason: v.string(),
    expectedScope: v.string(),
    riskLevel: v.string(),
    applied: v.boolean(),
    resultHash: v.optional(v.string()),
  }).index("by_run", ["editRunId", "opIndex"]),

  validationResults: defineTable({
    editRunId: v.id("editRuns"),
    versionId: v.optional(v.id("documentVersions")),
    validator: v.string(),
    status: v.union(v.literal("passed"), v.literal("warning"), v.literal("failed")),
    details: v.any(),
    createdAt: v.number(),
  }).index("by_run", ["editRunId", "createdAt"]),

  sectionIndex: defineTable({
    versionId: v.id("documentVersions"),
    nodeId: v.string(),
    sectionType: v.string(),
    domPath: v.string(),
    headingText: v.optional(v.string()),
    textSummary: v.string(),
    htmlExcerpt: v.string(),
    cssRefs: v.array(v.string()),
    contentHash: v.string(),
    tokenEstimate: v.number(),
    embedding: v.optional(v.array(v.number())),
  }).index("by_version", ["versionId", "sectionType"]),

  modelCalls: defineTable({
    editRunId: v.id("editRuns"),
    task: v.string(),
    provider: v.string(),
    model: v.string(),
    inputTokenEstimate: v.number(),
    outputTokenEstimate: v.number(),
    latencyMs: v.number(),
    status: v.string(),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_run", ["editRunId", "createdAt"]),
});
