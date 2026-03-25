import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Record model performance (upsert by model+taskType) ────
export const record = mutation({
  args: {
    model: v.string(),
    taskType: v.string(),
    project: v.optional(v.string()),
    metrics: v.object({
      completionTimeMs: v.float64(),
      tokensIn: v.float64(),
      tokensOut: v.float64(),
      costUsd: v.float64(),
      qualityScore: v.optional(v.float64()),
      successRate: v.float64(),
    }),
  },
  handler: async (ctx, args) => {
    // Find existing record for this model+taskType
    const existing = await ctx.db
      .query("modelPerformance")
      .withIndex("by_model_and_task", (q) =>
        q.eq("model", args.model).eq("taskType", args.taskType)
      )
      .first();

    if (existing) {
      // Running average: blend new metrics with existing
      const n = existing.sampleSize;
      const blend = (old: number, next: number) =>
        (old * n + next) / (n + 1);

      await ctx.db.patch(existing._id, {
        project: args.project ?? existing.project,
        metrics: {
          completionTimeMs: blend(existing.metrics.completionTimeMs, args.metrics.completionTimeMs),
          tokensIn: blend(existing.metrics.tokensIn, args.metrics.tokensIn),
          tokensOut: blend(existing.metrics.tokensOut, args.metrics.tokensOut),
          costUsd: blend(existing.metrics.costUsd, args.metrics.costUsd),
          qualityScore: args.metrics.qualityScore ?? existing.metrics.qualityScore,
          successRate: blend(existing.metrics.successRate, args.metrics.successRate),
        },
        sampleSize: n + 1,
        lastUpdatedAt: new Date().toISOString(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("modelPerformance", {
        model: args.model,
        taskType: args.taskType,
        project: args.project,
        metrics: args.metrics,
        sampleSize: 1,
        lastUpdatedAt: new Date().toISOString(),
        notes: undefined,
      });
    }
  },
});

// ─── Best model for a given task type ────────────────────────
export const bestModelFor = query({
  args: {
    taskType: v.string(),
    optimizeFor: v.optional(v.union(
      v.literal("cost"),
      v.literal("quality"),
      v.literal("speed")
    )),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("modelPerformance")
      .withIndex("by_task_type", (q) => q.eq("taskType", args.taskType))
      .collect();

    if (candidates.length === 0) return null;

    const opt = args.optimizeFor ?? "quality";
    candidates.sort((a, b) => {
      switch (opt) {
        case "cost":
          return a.metrics.costUsd - b.metrics.costUsd;
        case "speed":
          return a.metrics.completionTimeMs - b.metrics.completionTimeMs;
        case "quality":
        default:
          return (b.metrics.qualityScore ?? 0) - (a.metrics.qualityScore ?? 0)
            || b.metrics.successRate - a.metrics.successRate;
      }
    });

    return candidates[0];
  },
});

// ─── Cost report by model ────────────────────────────────────
export const costReport = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("modelPerformance").collect();
    const byModel: Record<string, { totalCost: number; totalSamples: number; tasks: string[] }> = {};

    for (const record of all) {
      if (!byModel[record.model]) {
        byModel[record.model] = { totalCost: 0, totalSamples: 0, tasks: [] };
      }
      byModel[record.model].totalCost += record.metrics.costUsd * record.sampleSize;
      byModel[record.model].totalSamples += record.sampleSize;
      byModel[record.model].tasks.push(record.taskType);
    }

    return Object.entries(byModel).map(([model, data]) => ({
      model,
      totalCostUsd: Math.round(data.totalCost * 10000) / 10000,
      totalSamples: data.totalSamples,
      avgCostPerTask: Math.round((data.totalCost / data.totalSamples) * 10000) / 10000,
      tasks: data.tasks,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  },
});

// ─── Compare two models on a task type ───────────────────────
export const compare = query({
  args: {
    modelA: v.string(),
    modelB: v.string(),
    taskType: v.string(),
  },
  handler: async (ctx, args) => {
    const [a, b] = await Promise.all([
      ctx.db
        .query("modelPerformance")
        .withIndex("by_model_and_task", (q) =>
          q.eq("model", args.modelA).eq("taskType", args.taskType)
        )
        .first(),
      ctx.db
        .query("modelPerformance")
        .withIndex("by_model_and_task", (q) =>
          q.eq("model", args.modelB).eq("taskType", args.taskType)
        )
        .first(),
    ]);

    if (!a || !b) {
      return {
        error: `Missing data: ${!a ? args.modelA : ""} ${!b ? args.modelB : ""}`.trim(),
        modelA: a ?? null,
        modelB: b ?? null,
      };
    }

    return {
      taskType: args.taskType,
      modelA: { model: a.model, ...a.metrics, sampleSize: a.sampleSize },
      modelB: { model: b.model, ...b.metrics, sampleSize: b.sampleSize },
      winner: {
        cost: a.metrics.costUsd <= b.metrics.costUsd ? args.modelA : args.modelB,
        speed: a.metrics.completionTimeMs <= b.metrics.completionTimeMs ? args.modelA : args.modelB,
        quality: (a.metrics.qualityScore ?? 0) >= (b.metrics.qualityScore ?? 0) ? args.modelA : args.modelB,
        successRate: a.metrics.successRate >= b.metrics.successRate ? args.modelA : args.modelB,
      },
    };
  },
});
