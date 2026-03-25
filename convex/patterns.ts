import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Record a detected pattern ───────────────────────────────
export const record = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    frequency: v.float64(),
    learningIds: v.array(v.id("learnings")),
    recommendation: v.string(),
    autoApply: v.boolean(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("patterns", {
      ...args,
      lastDetectedAt: now,
      createdAt: now,
    });
  },
});

// ─── Get auto-apply recommendations ──────────────────────────
export const getRecommendations = query({
  args: {
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const all = await ctx.db.query("patterns").collect();
    return all
      .filter((p) => p.autoApply)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  },
});

// ─── Filter by category ──────────────────────────────────────
export const byCategory = query({
  args: {
    category: v.string(),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("patterns")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .take(limit);
  },
});
