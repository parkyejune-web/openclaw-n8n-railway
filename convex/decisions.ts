import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Record a decision ───────────────────────────────────────
export const record = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    reasoning: v.string(),
    alternatives: v.array(v.object({
      option: v.string(),
      proscons: v.string(),
      rejected_reason: v.string(),
    })),
    context: v.object({
      project: v.optional(v.string()),
      stakeholder: v.optional(v.string()),
      constraint: v.optional(v.string()),
    }),
    decidedBy: v.string(),
    reversible: v.boolean(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("decisions", {
      ...args,
      outcome: undefined,
      decidedAt: new Date().toISOString(),
    });
  },
});

// ─── Record outcome for a decision ───────────────────────────
export const recordOutcome = mutation({
  args: {
    id: v.id("decisions"),
    result: v.string(),
    success: v.boolean(),
    lesson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error(`Decision ${args.id} not found`);
    await ctx.db.patch(args.id, {
      outcome: {
        result: args.result,
        measuredAt: new Date().toISOString(),
        success: args.success,
        lesson: args.lesson,
      },
    });
  },
});

// ─── Full-text search decisions ──────────────────────────────
export const search = query({
  args: {
    query: v.string(),
    project: v.optional(v.string()),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    let q = ctx.db
      .query("decisions")
      .withSearchIndex("search_decisions", (s) => {
        const base = s.search("description", args.query);
        return args.project ? base.eq("context.project", args.project) : base;
      });
    return await q.take(limit);
  },
});

// ─── Filter by project ───────────────────────────────────────
export const byProject = query({
  args: {
    project: v.string(),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("decisions")
      .withIndex("by_project", (q) => q.eq("context.project", args.project))
      .take(limit);
  },
});

// ─── Recent decisions ────────────────────────────────────────
export const recent = query({
  args: {
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("decisions")
      .withIndex("by_date")
      .order("desc")
      .take(limit);
  },
});
