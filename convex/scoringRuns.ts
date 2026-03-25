import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Scoring Runs — The experiment journal (autoresearch pattern)
 * Every judge pass is a "run". Tracks keep/discard/crash status.
 */

export const insert = mutation({
  args: {
    projectName: v.string(),
    runId: v.string(),
    parentRunId: v.optional(v.string()),
    timestamp: v.string(),
    rubricVersion: v.string(),
    scores: v.object({
      technical: v.number(),
      business: v.number(),
      dimensions: v.any(),
    }),
    status: v.union(
      v.literal("keep"),
      v.literal("discard"),
      v.literal("baseline"),
      v.literal("regression"),
      v.literal("crash")
    ),
    delta: v.optional(v.number()),
    description: v.string(),
    agentJournal: v.optional(v.string()),
    model: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scoringHistory", {
      projectName: args.projectName,
      timestamp: args.timestamp,
      scores: {
        ...args.scores.dimensions,
        _technical: args.scores.technical,
        _business: args.scores.business,
        _runId: args.runId,
        _parentRunId: args.parentRunId,
        _status: args.status,
        _delta: args.delta,
        _description: args.description,
        _agentJournal: args.agentJournal,
        _model: args.model,
        _triggeredBy: args.triggeredBy,
        _rubricVersion: args.rubricVersion,
      },
      composite: (args.scores.technical + args.scores.business) / 2,
    });
  },
});

export const getHistory = query({
  args: {
    projectName: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("scoringHistory")
      .withIndex("by_project", (q) => q.eq("projectName", args.projectName))
      .order("desc")
      .take(args.limit ?? 10);
    return results;
  },
});

export const getLatestPerProject = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const latest: Record<string, any> = {};
    for (const p of projects) {
      const lastScore = await ctx.db
        .query("scoringHistory")
        .withIndex("by_project", (q) => q.eq("projectName", p.name))
        .order("desc")
        .first();
      latest[p.name] = lastScore;
    }
    return latest;
  },
});

// List all scoring runs
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scoringHistory").order("desc").take(100);
  },
});
