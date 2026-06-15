import { v } from "convex/values";
import type { TableNamesInDataModel } from "convex/server";
import { internalMutation } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type Table = TableNamesInDataModel<DataModel>;

// Tables wiped on reset, ordered children-first for readability (Convex has no
// FK constraints, so order does not actually matter).
const TABLES: Table[] = [
  "modelCalls",
  "validationResults",
  "patchOps",
  "sectionIndex",
  "chatMessages",
  "editRuns",
  "documentVersions",
  "documents",
  "projects",
  "demoSessions",
];

async function wipe(ctx: MutationCtx, table: Table): Promise<number> {
  const rows = await ctx.db.query(table).collect();
  await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
  return rows.length;
}

/**
 * Reset the demo to a clean slate: deletes every document, version, run, log,
 * session, and the stored HTML snapshots. Run with:
 *   npx convex run admin:resetDemo
 *
 * This is an internalMutation — it is NOT callable from the client.
 */
export const resetDemo = internalMutation({
  args: {},
  returns: v.object({ deletedRows: v.number(), deletedFiles: v.number() }),
  handler: async (ctx) => {
    // Delete stored HTML snapshots first (reverts reuse storage IDs, so de-dupe).
    const versions = await ctx.db.query("documentVersions").collect();
    const storageIds = new Set(versions.map((version) => version.htmlStorageId));
    let deletedFiles = 0;
    for (const storageId of storageIds) {
      try {
        await ctx.storage.delete(storageId);
        deletedFiles += 1;
      } catch {
        // Already gone — ignore.
      }
    }

    let deletedRows = 0;
    for (const table of TABLES) {
      deletedRows += await wipe(ctx, table);
    }

    return { deletedRows, deletedFiles };
  },
});
