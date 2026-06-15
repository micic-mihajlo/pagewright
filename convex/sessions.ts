import { ConvexError, v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export function hashToken(token: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function requireSession(ctx: QueryCtx | MutationCtx, token: string) {
  const tokenHash = hashToken(token);
  const session = await ctx.db
    .query("demoSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (!session || session.expiresAt <= Date.now()) {
    throw new ConvexError({
      code: "SESSION_EXPIRED",
      message: "Your demo session expired. Enter the passcode again.",
    });
  }

  return session;
}

export async function touchSession(ctx: MutationCtx, token: string) {
  const session = await requireSession(ctx, token);
  await ctx.db.patch(session._id, { lastUsedAt: Date.now() });
  return session;
}

export const createSession = mutation({
  args: {
    passcode: v.string(),
    clientToken: v.string(),
  },
  returns: v.object({
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const configuredPasscode = process.env.APP_PASSCODE;
    if (!configuredPasscode) {
      throw new ConvexError({
        code: "PASSCODE_NOT_CONFIGURED",
        message: "APP_PASSCODE is not configured in Convex.",
      });
    }

    if (args.passcode !== configuredPasscode) {
      throw new ConvexError({
        code: "INVALID_PASSCODE",
        message: "The passcode is incorrect.",
      });
    }

    const now = Date.now();
    const ttlHours = Number(process.env.DEMO_SESSION_TTL_HOURS ?? "24");
    const expiresAt = now + Math.max(1, ttlHours) * 60 * 60 * 1000;
    const tokenHash = hashToken(args.clientToken);
    const existing = await ctx.db
      .query("demoSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { expiresAt, lastUsedAt: now });
    } else {
      await ctx.db.insert("demoSessions", {
        tokenHash,
        createdAt: now,
        expiresAt,
        lastUsedAt: now,
      });
    }

    return { token: args.clientToken, expiresAt };
  },
});

export const validateForAction = internalQuery({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    return null;
  },
});
