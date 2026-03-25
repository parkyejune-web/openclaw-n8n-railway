import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const learningCategory = v.union(
  v.literal("model_selection"),
  v.literal("architecture"),
  v.literal("client_context"),
  v.literal("code_pattern"),
  v.literal("cost_optimization"),
  v.literal("security"),
  v.literal("process"),
  v.literal("tool_usage"),
  v.literal("debugging"),
  v.literal("communication")
);

const impactLevel = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

const triggerType = v.union(
  v.literal("task_completion"),
  v.literal("error"),
  v.literal("human_feedback"),
  v.literal("cron_review"),
  v.literal("pattern_detection"),
  v.literal("manual")
);

// ─── Record a new learning ───────────────────────────────────
export const record = mutation({
  args: {
    category: learningCategory,
    subcategory: v.string(),
    title: v.string(),
    content: v.string(),
    context: v.object({
      project: v.optional(v.string()),
      task: v.optional(v.string()),
      session: v.optional(v.string()),
      cron: v.optional(v.string()),
    }),
    source: v.object({
      agent: v.string(),
      model: v.string(),
      trigger: triggerType,
    }),
    confidence: v.float64(),
    impact: impactLevel,
    tags: v.array(v.string()),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("learnings", {
      ...args,
      appliedCount: 0,
      lastAppliedAt: undefined,
      supersededBy: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ─── Full-text search learnings ──────────────────────────────
export const search = query({
  args: {
    query: v.string(),
    category: v.optional(learningCategory),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    let q = ctx.db
      .query("learnings")
      .withSearchIndex("search_content", (s) => {
        const base = s.search("content", args.query);
        return args.category ? base.eq("category", args.category) : base;
      });
    return await q.take(limit);
  },
});

// ─── Filter by category ──────────────────────────────────────
export const byCategory = query({
  args: {
    category: learningCategory,
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("learnings")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .take(limit);
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
      .query("learnings")
      .withIndex("by_project", (q) => q.eq("context.project", args.project))
      .take(limit);
  },
});

// ─── Mark a learning as applied ──────────────────────────────
export const markApplied = mutation({
  args: { id: v.id("learnings") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error(`Learning ${args.id} not found`);
    await ctx.db.patch(args.id, {
      appliedCount: existing.appliedCount + 1,
      lastAppliedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Supersede a learning with a newer one ───────────────────
export const supersede = mutation({
  args: {
    oldId: v.id("learnings"),
    newId: v.id("learnings"),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db.get(args.oldId);
    if (!old) throw new Error(`Learning ${args.oldId} not found`);
    const newer = await ctx.db.get(args.newId);
    if (!newer) throw new Error(`Learning ${args.newId} not found`);
    await ctx.db.patch(args.oldId, {
      supersededBy: args.newId,
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Get all active (non-superseded, non-expired) learnings ──
export const getActive = query({
  args: {
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const now = new Date().toISOString();
    const all = await ctx.db.query("learnings").take(limit * 3);
    return all
      .filter((l) => !l.supersededBy)
      .filter((l) => !l.expiresAt || l.expiresAt > now)
      .slice(0, limit);
  },
});

// ─── Top learnings by impact ─────────────────────────────────
export const topByImpact = query({
  args: {
    impact: v.optional(impactLevel),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const impact = args.impact ?? "critical";
    return await ctx.db
      .query("learnings")
      .withIndex("by_impact", (q) => q.eq("impact", impact))
      .take(limit);
  },
});

// List all learnings (for dashboard)
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("learnings").order("desc").take(100);
  },
});

// Add a learning (from Temporal activities)
export const add = mutation({
  args: {
    content: v.string(),
    category: v.string(),
    impact: v.string(),
    context: v.optional(v.object({ 
      project: v.optional(v.string()),
      task: v.optional(v.string()),
      session: v.optional(v.string()),
      cron: v.optional(v.string()),
    })),
    tags: v.optional(v.array(v.string())),
    trigger: v.optional(v.string()),
    timestamp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("learnings", {
      content: args.content,
      title: args.content.substring(0, 100),
      subcategory: "general",
      category: args.category as any,
      impact: args.impact as any,
      context: args.context || { project: "system" },
      source: {
        agent: "temporal-worker",
        model: "system",
        trigger: (args.trigger || "manual") as any,
      },
      confidence: 0.8,
      appliedCount: 0,
      tags: args.tags || [],
      createdAt: args.timestamp || now,
      updatedAt: now,
    });
  },
});
