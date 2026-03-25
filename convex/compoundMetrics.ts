import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Upsert daily compound metrics ──────────────────────────
export const recordDaily = mutation({
  args: {
    date: v.string(),
    totalLearnings: v.float64(),
    learningsApplied: v.float64(),
    decisionsLogged: v.float64(),
    patternsDetected: v.float64(),
    feedbackReceived: v.float64(),
    modelCostUsd: v.float64(),
    tasksCompleted: v.float64(),
    tasksSuccessRate: v.float64(),
    avgCompletionTimeMs: v.float64(),
    topCategories: v.array(v.object({
      category: v.string(),
      count: v.float64(),
    })),
  },
  handler: async (ctx, args) => {
    // Upsert: check if today already has a record
    const existing = await ctx.db
      .query("compoundMetrics")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    } else {
      return await ctx.db.insert("compoundMetrics", args);
    }
  },
});

// ─── Trend: last N days of metrics ───────────────────────────
export const trend = query({
  args: {
    days: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 30;
    return await ctx.db
      .query("compoundMetrics")
      .withIndex("by_date")
      .order("desc")
      .take(days);
  },
});

// ─── Current: today's metrics ────────────────────────────────
export const current = query({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];
    return await ctx.db
      .query("compoundMetrics")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
  },
});
