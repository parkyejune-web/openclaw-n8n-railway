import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Trajectories — Every agent action logged with state-before and state-after.
 * Core of the compound learning loop.
 */

export const insert = mutation({
  args: {
    projectName: v.string(),
    sessionKey: v.string(),
    agentModel: v.string(),
    timestamp: v.string(),
    stateBefore: v.object({
      scores: v.any(),
      openTasks: v.number(),
      lastCommit: v.string(),
    }),
    action: v.object({
      type: v.string(),
      description: v.string(),
      filesChanged: v.array(v.string()),
      toolsUsed: v.array(v.string()),
      reasoning: v.string(),
      tokensUsed: v.number(),
      costUsd: v.number(),
    }),
    stateAfter: v.object({
      scores: v.any(),
      openTasks: v.number(),
      lastCommit: v.string(),
    }),
    scoreDelta: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("trajectories", {
      ...args,
      humanFeedback: undefined,
      outcome: undefined,
    });
  },
});

export const addFeedback = mutation({
  args: {
    trajectoryId: v.id("trajectories"),
    rating: v.number(),
    comment: v.optional(v.string()),
    correctedAction: v.optional(v.string()),
    timestamp: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.trajectoryId, {
      humanFeedback: {
        rating: args.rating,
        comment: args.comment,
        correctedAction: args.correctedAction,
        timestamp: args.timestamp,
      },
    });
  },
});

export const addOutcome = mutation({
  args: {
    trajectoryId: v.id("trajectories"),
    measuredAt: v.string(),
    velocityImpact: v.number(),
    qualityImpact: v.number(),
    wasCorrect: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.trajectoryId, {
      outcome: {
        measuredAt: args.measuredAt,
        velocityImpact: args.velocityImpact,
        qualityImpact: args.qualityImpact,
        wasCorrect: args.wasCorrect,
      },
    });
  },
});

export const listByProject = query({
  args: {
    projectName: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("trajectories")
      .withIndex("by_project", (q) => q.eq("projectName", args.projectName))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return ctx.db
      .query("trajectories")
      .order("desc")
      .take(args.limit ?? 50);
  },
});
