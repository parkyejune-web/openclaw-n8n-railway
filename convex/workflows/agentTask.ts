/**
 * Durable execution wrapper for OpenClaw LLM agent tasks.
 *
 * Each workflow step is individually retried and journaled by Convex, so a
 * crash mid-task replays from the last completed step rather than restarting
 * from scratch.
 *
 * Note: The 10-minute per-action timeout means long LLM calls should be split
 * into continuation steps (prompt → stream → collect → next prompt).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { workflow } from "../index";

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const agentTaskWorkflow = workflow.define({
  args: {
    taskDescription: v.string(),
    agentId: v.optional(v.string()),
    // Model fallback chain — first entry is primary, rest are fallbacks.
    models: v.optional(v.array(v.string())),
    maxRetries: v.optional(v.number()),
    // Public gateway URL (e.g. https://openclaw-gw.example.com).
    gatewayUrl: v.string(),
    // Bearer token for gateway auth.
    gatewayToken: v.optional(v.string()),
  },
  returns: v.object({
    status: v.string(),
    output: v.optional(v.string()),
    model: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  }),
  handler: async (step, args) => {
    const startMs = Date.now();

    // Step 1: Record the task in our tracking table.
    await step.runMutation(internal.workflows.agentTask.recordStart, {
      workflowId: step.workflowId,
      taskDescription: args.taskDescription,
      agentId: args.agentId,
    });

    // Step 2: Execute the LLM call with model fallback.
    const result = await step.runAction(
      internal.workflows.agentTask.executeLlmCall,
      {
        taskDescription: args.taskDescription,
        agentId: args.agentId ?? "default",
        models: args.models ?? [],
        maxRetries: args.maxRetries ?? 2,
        gatewayUrl: args.gatewayUrl,
        gatewayToken: args.gatewayToken ?? "",
      },
    );

    // Step 3: Persist the result.
    await step.runMutation(internal.workflows.agentTask.recordResult, {
      workflowId: step.workflowId,
      status: result.status,
      output: result.output,
      model: result.model,
    });

    return {
      status: result.status,
      output: result.output,
      model: result.model,
      durationMs: Date.now() - startMs,
    };
  },
});

// ---------------------------------------------------------------------------
// Supporting functions (called as workflow steps)
// ---------------------------------------------------------------------------

export const recordStart = internalMutation({
  args: {
    workflowId: v.string(),
    taskDescription: v.string(),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("openclawWorkflows", {
      type: "agentTask",
      workflowId: args.workflowId,
      context: {
        taskDescription: args.taskDescription,
        agentId: args.agentId,
      },
      startedAt: Date.now(),
    });
  },
});

export const executeLlmCall = internalAction({
  args: {
    taskDescription: v.string(),
    agentId: v.string(),
    models: v.array(v.string()),
    maxRetries: v.number(),
    gatewayUrl: v.string(),
    gatewayToken: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!args.gatewayUrl) {
      return {
        status: "failed" as const,
        output: "No gateway URL configured",
        model: undefined,
      };
    }

    const models = args.models.length > 0 ? args.models : ["default"];
    let lastError = "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (args.gatewayToken) {
      headers["Authorization"] = `Bearer ${args.gatewayToken}`;
    }

    const endpoint =
      args.gatewayUrl.replace(/\/$/, "") + "/v1/chat/completions";

    // Model fallback: try each model in sequence until one succeeds.
    for (const model of models) {
      try {
        console.log(
          `[agentTask] executing task="${args.taskDescription}" agent=${args.agentId} model=${model}`,
        );

        const resp = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `You are agent "${args.agentId}". Complete the following task.`,
              },
              { role: "user", content: args.taskDescription },
            ],
          }),
          signal: AbortSignal.timeout(120_000), // 2 min per attempt
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
        }

        const data = await resp.json();
        const content =
          data.choices?.[0]?.message?.content ?? JSON.stringify(data);
        const usedModel = data.model ?? model;

        return {
          status: "completed" as const,
          output: content,
          model: usedModel,
        };
      } catch (err) {
        lastError = String(err);
        console.warn(
          `[agentTask] model=${model} failed: ${lastError}, trying next fallback...`,
        );
      }
    }

    return {
      status: "failed" as const,
      output: `All models exhausted. Last error: ${lastError}`,
      model: undefined,
    };
  },
});

export const recordResult = internalMutation({
  args: {
    workflowId: v.string(),
    status: v.string(),
    output: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("openclawWorkflows")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        result: {
          kind: args.status === "completed" ? "success" as const : "error" as const,
          ...(args.status === "completed"
            ? { returnValue: { output: args.output, model: args.model } }
            : { error: args.output ?? "Unknown error" }),
        },
        completedAt: Date.now(),
      });
    }
  },
});
