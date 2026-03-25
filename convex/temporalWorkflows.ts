import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Full workflow upsert — supports all fields the dashboard needs
export const upsert = mutation({
  args: {
    workflowId: v.string(),
    runId: v.optional(v.string()),
    status: v.string(),
    workflowType: v.optional(v.string()),
    taskQueue: v.optional(v.string()),
    startTime: v.optional(v.string()),
    closeTime: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    runTimeMs: v.optional(v.float64()),
    currentStep: v.optional(v.string()),
    projectName: v.optional(v.string()),
    error: v.optional(v.string()),
    result: v.optional(v.string()),
    sequenceNumber: v.optional(v.float64()),
    previousRunIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Auto-set updatedAt if not provided
    if (!args.updatedAt) {
      args.updatedAt = new Date().toISOString();
    }

    const existing = await ctx.db
      .query("temporalWorkflows")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .first();

    if (existing) {
      // Sequence number check — reject stale updates
      if (
        args.sequenceNumber !== undefined &&
        existing.sequenceNumber !== undefined &&
        args.sequenceNumber <= existing.sequenceNumber
      ) {
        return existing._id;
      }

      // Preserve runId history
      if (args.runId && existing.runId && existing.runId !== args.runId) {
        args.previousRunIds = [...(existing.previousRunIds || []), existing.runId];
      }

      await ctx.db.patch(existing._id, args);
      return existing._id;
    } else {
      return await ctx.db.insert("temporalWorkflows", args);
    }
  },
});

// Batch upsert — used by temporal-sync API route
export const batchUpsert = mutation({
  args: {
    workflows: v.array(
      v.object({
        workflowId: v.string(),
        runId: v.optional(v.string()),
        status: v.string(),
        workflowType: v.optional(v.string()),
        taskQueue: v.optional(v.string()),
        startTime: v.optional(v.string()),
        closeTime: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
        runTimeMs: v.optional(v.float64()),
        currentStep: v.optional(v.string()),
        projectName: v.optional(v.string()),
        error: v.optional(v.string()),
        result: v.optional(v.string()),
        sequenceNumber: v.optional(v.float64()),
        previousRunIds: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    let count = 0;
    for (const wf of args.workflows) {
      if (!wf.updatedAt) {
        wf.updatedAt = new Date().toISOString();
      }

      const existing = await ctx.db
        .query("temporalWorkflows")
        .withIndex("by_workflow_id", (q) => q.eq("workflowId", wf.workflowId))
        .first();

      if (existing) {
        if (
          wf.sequenceNumber !== undefined &&
          existing.sequenceNumber !== undefined &&
          wf.sequenceNumber <= existing.sequenceNumber
        ) {
          continue; // Skip stale
        }
        await ctx.db.patch(existing._id, wf);
      } else {
        await ctx.db.insert("temporalWorkflows", wf);
      }
      count++;
    }
    return count;
  },
});

// List active workflows + recently completed (for dashboard)
// Returns flat array, not paginated — dashboard renders all visible workflows
export const listActive = query({
  args: {
    includeRecentMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const recentMinutes = args.includeRecentMinutes ?? 30;
    const cutoff = new Date(Date.now() - recentMinutes * 60 * 1000).toISOString();

    // Get all non-completed workflows (always show these)
    const active = await ctx.db
      .query("temporalWorkflows")
      .withIndex("by_status_updated")
      .filter((q) => q.neq(q.field("status"), "COMPLETED"))
      .collect();

    // Get recently completed/failed (within the time window)
    const recent = await ctx.db
      .query("temporalWorkflows")
      .withIndex("by_status_updated")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "COMPLETED"),
          q.gte(q.field("updatedAt"), cutoff)
        )
      )
      .collect();

    // Combine and sort by updatedAt descending
    const all = [...active, ...recent].sort((a, b) => {
      const aTime = a.updatedAt ?? a.startTime ?? "";
      const bTime = b.updatedAt ?? b.startTime ?? "";
      return bTime.localeCompare(aTime);
    });

    return all;
  },
});

// Status counts for summary bar
export const statusCounts = query({
  handler: async (ctx) => {
    const all = await ctx.db.query("temporalWorkflows").collect();
    const counts: Record<string, number> = {};
    for (const wf of all) {
      const status = (wf.status || "unknown").toUpperCase();
      counts[status] = (counts[status] || 0) + 1;
    }
    // Normalize keys to lowercase for dashboard compatibility
    const normalized: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      normalized[k.toLowerCase()] = v;
    }
    return normalized;
  },
});

// Cleanup old completed workflows
export const cleanupStale = mutation({
  args: { olderThanHours: v.number() },
  handler: async (ctx, args) => {
    const cutoff = new Date(
      Date.now() - args.olderThanHours * 60 * 60 * 1000
    ).toISOString();
    const stale = await ctx.db
      .query("temporalWorkflows")
      .withIndex("by_status_updated")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "COMPLETED"),
          q.lt(q.field("updatedAt"), cutoff)
        )
      )
      .collect();

    let deleted = 0;
    for (const workflow of stale) {
      await ctx.db.delete(workflow._id);
      deleted++;
    }

    return { deleted };
  },
});
