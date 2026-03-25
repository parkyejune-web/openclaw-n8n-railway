import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const scoresValidator = v.object({
  sdlc_completeness: v.number(),
  code_quality: v.number(),
  security_posture: v.number(),
  qa_quality: v.number(),
  deployment_health: v.number(),
  gtm_readiness: v.number(),
  sales_pipeline: v.number(),
  revenue_proximity: v.number(),
  strategic_value: v.number(),
  velocity: v.number(),
  tech_debt: v.number(),
  market_timing: v.number(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("projects").collect();
  },
});

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("projects")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
  },
});

export const upsert = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    type: v.optional(v.string()),
    sdlcStage: v.string(),
    scores: scoresValidator,
    services: v.array(v.string()),
    score: v.number(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        color: args.color,
        type: args.type,
        sdlcStage: args.sdlcStage,
        scores: args.scores,
        services: args.services,
        score: args.score,
        updatedAt: args.updatedAt,
      });

      // Also record scoring history
      await ctx.db.insert("scoringHistory", {
        projectName: args.name,
        timestamp: args.updatedAt,
        scores: args.scores,
        composite: args.score,
      });

      return existing._id;
    } else {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        color: args.color,
        type: args.type,
        sdlcStage: args.sdlcStage,
        scores: args.scores,
        services: args.services,
        score: args.score,
        updatedAt: args.updatedAt,
      });

      await ctx.db.insert("scoringHistory", {
        projectName: args.name,
        timestamp: args.updatedAt,
        scores: args.scores,
        composite: args.score,
      });

      return id;
    }
  },
});

export const batchUpsert = mutation({
  args: {
    items: v.array(
      v.object({
        name: v.string(),
        color: v.string(),
        type: v.optional(v.string()),
        sdlcStage: v.string(),
        scores: scoresValidator,
        services: v.array(v.string()),
        score: v.number(),
        updatedAt: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const item of args.items) {
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_name", (q) => q.eq("name", item.name))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          color: item.color,
          type: item.type,
          sdlcStage: item.sdlcStage,
          scores: item.scores,
          services: item.services,
          score: item.score,
          updatedAt: item.updatedAt,
        });
      } else {
        await ctx.db.insert("projects", item);
      }

      await ctx.db.insert("scoringHistory", {
        projectName: item.name,
        timestamp: item.updatedAt,
        scores: item.scores,
        composite: item.score,
      });

      upserted++;
    }
    return upserted;
  },
});

