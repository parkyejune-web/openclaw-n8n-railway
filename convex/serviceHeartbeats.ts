/**
 * serviceHeartbeats — Convex mutations & queries
 *
 * Each Railway service writes a heartbeat here every 60s via the heartbeat reporter.
 * Agent Ops Center dashboard reads this for the live green/yellow/red service grid.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// ── Upsert (called by every service every 60s) ────────────────────────────────

export const upsert = mutation({
  args: {
    service: v.string(),
    job: v.optional(v.union(v.string(), v.null())),
    status: v.union(
      v.literal('ok'),
      v.literal('running'),
      v.literal('error'),
      v.literal('degraded')
    ),
    metadata: v.optional(v.any()),
    timestamp: v.string(),
  },
  handler: async (ctx, args) => {
    const jobKey = args.job ?? '__service__';
    // Use filter instead of withIndex to avoid stale type errors
    const all = await ctx.db.query('serviceHeartbeats' as any).collect();
    const existing = (all as any[]).find(
      (r) => r.service === args.service && r.jobKey === jobKey
    );

    const now = Date.now();
    const record = {
      service: args.service,
      jobKey,
      job: args.job ?? null,
      status: args.status,
      metadata: args.metadata ?? {},
      lastSeenAt: args.timestamp,
      lastSeenMs: now,
      consecutiveFailures:
        args.status === 'error'
          ? ((existing?.consecutiveFailures ?? 0) as number) + 1
          : 0,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
    } else {
      await (ctx.db.insert as any)('serviceHeartbeats', {
        ...record,
        createdAt: new Date().toISOString(),
      });
    }
  },
});

// ── List all heartbeats (for dashboard grid) ──────────────────────────────────

export const listAll = query({
  handler: async (ctx) => {
    return (ctx.db.query as any)('serviceHeartbeats').collect();
  },
});

// ── Get single service ────────────────────────────────────────────────────────

export const getService = query({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const all = await (ctx.db.query as any)('serviceHeartbeats').collect();
    return (all as any[]).filter((r) => r.service === args.service);
  },
});

// ── Compute grid summary (dead = no heartbeat in > 2 min) ────────────────────

export const gridSummary = query({
  handler: async (ctx) => {
    const rows: any[] = await (ctx.db.query as any)('serviceHeartbeats').collect();
    const now = Date.now();
    const DEAD_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    return rows.map((row) => {
      const ageMs = now - (row.lastSeenMs ?? 0);
      const isDead = ageMs > DEAD_THRESHOLD_MS;

      let displayStatus: 'green' | 'yellow' | 'red' | 'dead';
      if (isDead) {
        displayStatus = 'dead';
      } else if (row.status === 'ok') {
        displayStatus = 'green';
      } else if (row.status === 'running' || row.status === 'degraded') {
        displayStatus = 'yellow';
      } else {
        displayStatus = 'red';
      }

      return {
        service: row.service,
        job: row.job,
        status: row.status,
        displayStatus,
        lastSeenAt: row.lastSeenAt,
        ageSeconds: Math.round(ageMs / 1000),
        consecutiveFailures: row.consecutiveFailures ?? 0,
        metadata: row.metadata,
      };
    });
  },
});
