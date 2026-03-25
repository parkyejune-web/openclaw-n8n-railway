import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { projectName: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("tasks").collect();
    const filtered = args.projectName
      ? results.filter((t) => t.projectName === args.projectName)
      : results;
    const limit = args.limit ?? 200;
    return filtered.slice(0, limit);
  },
});

export const byStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("tasks").collect();
    return results.filter((t) => t.status === args.status);
  },
});

export const upsert = mutation({
  args: {
    taskId: v.string(),
    task: v.string(),
    model: v.string(),
    status: v.string(),
    priority: v.string(),
    projectName: v.string(),
    createdAt: v.string(),
    completedAt: v.optional(v.string()),
    result: v.optional(v.string()),
    logs: v.array(v.object({ time: v.string(), message: v.string() })),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("tasks").collect();
    const existing = all.find((t) => t.taskId === args.taskId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        task: args.task,
        model: args.model,
        status: args.status,
        priority: args.priority,
        projectName: args.projectName,
        completedAt: args.completedAt,
        result: args.result,
      });
      return existing._id;
    } else {
      return ctx.db.insert("tasks", {
        taskId: args.taskId,
        task: args.task,
        model: args.model,
        status: args.status,
        priority: args.priority,
        projectName: args.projectName,
        createdAt: args.createdAt,
        completedAt: args.completedAt,
        result: args.result,
        logs: args.logs,
      });
    }
  },
});

export const batchUpsert = mutation({
  args: {
    items: v.array(
      v.object({
        taskId: v.string(),
        task: v.string(),
        model: v.string(),
        status: v.string(),
        priority: v.string(),
        projectName: v.string(),
        createdAt: v.string(),
        completedAt: v.optional(v.string()),
        result: v.optional(v.string()),
        filename: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        column: v.optional(v.string()),
        logs: v.array(v.object({ time: v.string(), message: v.string() })),
      })
    ),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    const all = await ctx.db.query("tasks").collect();
    for (const item of args.items) {
      const existing = all.find((t) => t.taskId === item.taskId);
      if (existing) {
        await ctx.db.patch(existing._id, {
          task: item.task,
          model: item.model,
          status: item.status,
          priority: item.priority,
          projectName: item.projectName,
          completedAt: item.completedAt,
          result: item.result,
        });
      } else {
        await ctx.db.insert("tasks", item);
      }
      upserted++;
    }
    return upserted;
  },
});

// Kanban-specific mutations
export const moveToColumn = mutation({
  args: {
    taskId: v.string(),
    column: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done"),
      v.literal("blocked")
    ),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("kanban").collect();
    const existing = all.find((k) => k.taskId === args.taskId);

    if (existing) {
      await ctx.db.patch(existing._id, { column: args.column });
    } else {
      await ctx.db.insert("kanban", {
        taskId: args.taskId,
        column: args.column,
        order: 0,
      });
    }
  },
});

// Upsert for Temporal workflow state updates
export const upsertWorkflowState = mutation({
  args: {
    taskId: v.string(),
    projectName: v.optional(v.string()),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    column: v.optional(v.string()),
    details: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("tasks").collect();
    const existing = all.find((t) => t.taskId === args.taskId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.status && { status: args.status }),
        ...(args.title && { task: args.title }),
        ...(args.details && { result: args.details }),
        ...(args.updatedAt && { completedAt: args.updatedAt }),
      });
      return existing._id;
    }

    return await ctx.db.insert("tasks", {
      taskId: args.taskId,
      task: args.title || args.taskId,
      model: "temporal",
      status: args.status || "pending",
      priority: "medium",
      projectName: args.projectName || "system",
      createdAt: new Date().toISOString(),
      completedAt: args.updatedAt,
      result: args.details,
      logs: [],
    });
  },
});
