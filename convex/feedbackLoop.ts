import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const severityLevel = v.union(
  v.literal("critical"),
  v.literal("important"),
  v.literal("minor")
);

// ─── Record human feedback/correction ────────────────────────
export const record = mutation({
  args: {
    sessionKey: v.string(),
    agentAction: v.string(),
    humanCorrection: v.string(),
    category: v.string(),
    severity: severityLevel,
    learningGenerated: v.optional(v.id("learnings")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("feedbackLoop", {
      ...args,
      timestamp: new Date().toISOString(),
    });
  },
});

// ─── Recent feedback ─────────────────────────────────────────
export const recent = query({
  args: {
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("feedbackLoop")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

// ─── Filter by severity ──────────────────────────────────────
export const bySeverity = query({
  args: {
    severity: severityLevel,
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    // No direct severity index, filter in memory (table is small)
    const all = await ctx.db
      .query("feedbackLoop")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit * 5);
    return all.filter((f) => f.severity === args.severity).slice(0, limit);
  },
});
