import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { projectName: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("conversations").collect();
    const filtered = args.projectName
      ? results.filter((c) => c.projectName === args.projectName)
      : results;
    return filtered.slice(0, args.limit ?? 100);
  },
});

export const upsert = mutation({
  args: {
    sessionKey: v.string(),
    projectName: v.string(),
    messages: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
        timestamp: v.string(),
      })
    ),
    startedAt: v.string(),
    updatedAt: v.string(),
    model: v.string(),
    tokensUsed: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Find by sessionKey
    const all = await ctx.db.query("conversations").collect();
    const existing = all.find((c) => c.sessionKey === args.sessionKey);

    if (existing) {
      await ctx.db.patch(existing._id, {
        messages: args.messages,
        updatedAt: args.updatedAt,
        tokensUsed: args.tokensUsed,
        status: args.status,
      });
      return existing._id;
    } else {
      return ctx.db.insert("conversations", args);
    }
  },
});
