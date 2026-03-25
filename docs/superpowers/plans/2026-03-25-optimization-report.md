# OpenClaw Service Mesh Optimization Report

**Date:** 2026-03-25
**Current version:** OpenClaw 2026.3.8 (stable: v2026.3.22 available)
**Services:** OpenClaw Gateway, Convex (self-hosted), Temporal, temporal-worker, Agent Ops Center, n8n, Redis, PostgreSQL

---

## Executive Summary

The service mesh is now connected end-to-end (verified: heartbeat `gatewayOk: true, healthy: true`). This report identifies 23 optimizations across 6 categories that would maximize throughput, reduce cost, improve reliability, and leverage all connected services to their full potential.

---

## 1. Model Configuration Optimizations

### 1.1 Duplicate Provider Definitions (HIGH — Cost/Confusion)
**Finding:** `models.json` has duplicate provider blocks:
- `minimax` and `minimax-portal` — identical baseUrl, identical models, identical API key
- `kimi-coding` and `kimi` — both point to `api.kimi.com/coding/` with same API key
- `moonshot` — separate provider for Kimi models at `api.moonshot.cn/v1`

**Impact:** Model fallback chains can bounce between duplicate providers, wasting time on the same backend. Operators can't tell which provider was used.

**Recommendation:** Consolidate to one provider per API endpoint:
- Merge `minimax` + `minimax-portal` → single `minimax` provider
- Merge `kimi-coding` + `kimi` → single `kimi` provider (keep `kimi-code` as the model ID)
- Keep `moonshot` separate (different API endpoint: `api.moonshot.cn` vs `api.kimi.com`)

### 1.2 Model Cost Data Missing (MEDIUM — Observability)
**Finding:** Most models have `cost: { input: 0, output: 0 }` — DeepSeek, Kimi, Moonshot, OpenRouter models all report $0. Only Grok and MiniMax have real cost data.

**Impact:** The Agent Ops Center's `modelPerformance` functions track cost per model, but with zero-cost data, cost optimization reports are useless. Cron job `fl-morning-score-climb` and project-scoring can't calculate true spend.

**Recommendation:** Update cost fields for:
- DeepSeek Chat: $0.14/M input, $0.28/M output
- DeepSeek Reasoner: $0.55/M input, $2.19/M output
- Kimi K2.5: currently free but document as promotional pricing
- OpenRouter auto: varies (use OpenRouter's cost API to record actual spend)

### 1.3 GPT-4.1 Models Still in Config (LOW — Compliance)
**Finding:** HEARTBEAT.md says "NEVER use GPT 4.1 or GPT 4.1 Mini" (Nathan's explicit instruction), but `models.json` still registers `gpt-4.1`, `gpt-4.1-mini`, and `gpt-4.1-nano` under the `openai` provider.

**Recommendation:** Remove all GPT-4.1 variants from `models.json` to prevent accidental use via model fallback chains.

### 1.4 Grok 4 Fast — Underutilized Powerhouse (HIGH — Performance)
**Finding:** `grok-4-fast` has a **2M token context window** at $0.20/M input — that's 10x the context of Opus for 1/75th the price. Currently not assigned to any cron job or role.

**Recommendation:** Use `xai/grok-4-fast` for:
- **Judge swarms** (t1/t2/t3) — 2M context can hold entire repo snapshots without chunking
- **hourly-consolidate** — can process all daily memory files in one pass
- Replace Opus 4.6 for judge swarms: **saves ~$45/day** at current cron frequency (6 judge runs × ~$7.50 each)

### 1.5 MiniMax M2.7 Available But Not Used (MEDIUM — Performance)
**Finding:** `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` are registered but unused. M2.7 is MiniMax's latest with improved reasoning.

**Recommendation:** Promote `MiniMax-M2.7-highspeed` as the orchestration model (replacing M2.5 references in OpenRouter routing config).

---

## 2. Cron Job Optimizations

### 2.1 Judge Swarms: Wrong Model Reference (FIXED — was Critical)
**Finding:** HEARTBEAT.md referenced `kimi/kimi-k2.5` but config section says judge swarms use Opus 4.6. The Kimi reference was for "light tasks" (rapid-health, hourly-consolidate, git-sync). Fixed to `kimi-coding/k2p5`.

**Status:** Fixed in this session. But the actual `cron list` may still have stale model assignments.

### 2.2 Cron Jobs Should Route Through Temporal (HIGH — Reliability)
**Finding:** Current cron jobs run as OpenClaw sub-agent spawns — if the gateway crashes mid-cron, the job is lost with no retry. Temporal provides durable execution with automatic retry, timeout handling, and workflow history.

**Current flow:** `OpenClaw cron → spawn sub-agent → execute → hope it completes`
**Optimal flow:** `OpenClaw cron → POST to temporal-worker → Temporal workflow → durable execution → record in Convex`

**Impact:** The temporal-worker already has the API (`/api/trigger/*`) and the Convex functions to record results. The TODO.md says "Wire cron jobs to Temporal workflows" is in-progress.

**Recommendation:** Priority order for migration:
1. `service-health` (self-healing — most critical to not lose)
2. `judge-swarm-t1/t2/t3` (longest running, most likely to timeout)
3. `project-scoring` (writes to Convex — natural Temporal fit)
4. `todo-progress` (state-dependent — benefits from workflow replay)

### 2.3 Redundant Health Checks (MEDIUM — Cost)
**Finding:** Three overlapping health monitoring systems:
- `rapid-health` every 15min (Gemini 3.1 Pro, detect-only)
- `service-health` every 2h (Sonnet 4.6, self-healing)
- Heartbeat checks (Mistral Small 3.1, per HEARTBEAT.md)

All three check service status. The Convex `serviceHeartbeats` table can aggregate these.

**Recommendation:**
- Consolidate `rapid-health` + heartbeat health checks into a single lightweight Temporal workflow that:
  1. Pings all Railway services via internal domains
  2. Writes results to `serviceHeartbeats.upsert()` in Convex
  3. Only escalates to `service-health` (Sonnet 4.6) if failures detected
- **Saves:** ~96 Gemini API calls/day + reduces heartbeat token burn

### 2.4 git-sync Is Unnecessarily Expensive (LOW — Cost)
**Finding:** `git-sync` runs every 6h using Kimi K2.5 to commit and push workspace changes. This doesn't need an LLM at all — it's a `git add . && git commit && git push`.

**Recommendation:** Replace with a Temporal workflow that runs shell commands directly, or a simple cron script. No LLM needed.

---

## 3. Convex Optimizations

### 3.1 Unified Convex Deployment (CRITICAL — Done This Session)
**Finding:** Two separate codebases (this repo + Agent Ops Center) were deploying to the same Convex instance, overwriting each other's functions.

**Status:** Fixed — all 77 functions now deployed from this repo. Agent Ops Center functions merged into `convex/` directory.

**Follow-up needed:** Update Agent Ops Center's build to NOT run `npx convex deploy` (or set its `CONVEX_DEPLOY_KEY` to empty). Otherwise the next Agent Ops Center deploy will overwrite the merged functions.

### 3.2 INFRASTRUCTURE.md Still References Convex Cloud (MEDIUM — Accuracy)
**Finding:** INFRASTRUCTURE.md says:
- "Currently using Convex Cloud for all scoring/learning data"
- Agent Ops Center points to `ideal-oriole-681.convex.cloud`
- Lists Convex Cloud as "LIVE — 15 tables, 29 indexes"

This is stale — we migrated to self-hosted (`convex-backend-production-95d6.up.railway.app`).

**Recommendation:** Update INFRASTRUCTURE.md to reflect:
- Self-hosted Convex is the **only** instance
- Remove Convex Cloud references
- Update Agent Ops Center `CONVEX_URL` reference

### 3.3 Missing Convex Indexes for Common Queries (MEDIUM — Performance)
**Finding:** The merged functions have tables without indexes on frequently-queried fields:
- `learnings` table: has `by_category`, `by_project`, `by_impact`, `by_tags` but no `by_timestamp`
- `temporalWorkflows`: no index on `workflowType` (the temporal-worker queries by type)
- `serviceHeartbeats`: no index (queried by `serviceId` in `getService`)

**Recommendation:** Add indexes via schema.ts:
```
learnings: by_timestamp → [_creationTime]
temporalWorkflows: by_type → [workflowType, _creationTime]
serviceHeartbeats: by_service → [serviceId, _creationTime]
```

### 3.4 Add Convex Scheduled Functions for Cleanup (LOW — Maintenance)
**Finding:** `temporalWorkflows.cleanupStale` exists but isn't called automatically. Stale workflow records accumulate.

**Recommendation:** Create a Convex scheduled function (cron) that runs `cleanupStale` daily. This runs inside Convex — no external trigger needed.

---

## 4. Temporal Optimizations

### 4.1 Wire Service Health to Temporal (HIGH — Core Architecture)
**Finding:** The temporal-worker has workflow types for `cronServiceHealthWorkflow`, `cronTodoProgressWorkflow`, `cronProjectScoringWorkflow`, and `cronJudgeSwarmWorkflow`. These exist but aren't being triggered by OpenClaw crons yet.

**Impact:** Every cron job that runs as a raw sub-agent spawn is a reliability risk. Temporal provides:
- **Durable execution** — survives gateway crashes
- **Automatic retries** — configurable per activity
- **Workflow history** — full audit trail in Temporal + Convex
- **Timeouts** — proper handling (not just "hope it finishes in 30min")

**Recommendation:** Add a Convex action `triggerTemporalWorkflow` that:
1. Accepts workflow type + parameters
2. POSTs to `http://temporal-worker.railway.internal:8090/api/trigger/<type>`
3. Records the workflow ID in Convex `temporalWorkflows` table
4. Returns workflow ID for status tracking

Then update cron model configs to call this action instead of spawning sub-agents.

### 4.2 Temporal Worker → Convex Sync (MEDIUM — Observability)
**Finding:** The temporal-worker pushes status updates to Convex via `/api/temporal-sync`, but the Agent Ops Center's `TemporalDashboard` component needs real-time Convex subscriptions to show live pipeline visualization.

**Recommendation:** Ensure the temporal-worker calls `temporalWorkflows.upsert()` on every workflow state change (started, completed, failed). The Convex reactive query system will automatically push updates to the dashboard.

### 4.3 Add Workflow Signal Handlers for Human-in-the-Loop (MEDIUM — Capability)
**Finding:** The Agent Ops Center has a `/api/temporal-signal` route for approval buttons, but no Temporal workflows actually use signals for human approval yet.

**Use case:** Judge swarm results could require Nathan's approval before auto-creating PRs. The workflow would:
1. Run judge analysis
2. Signal "awaiting approval" → appears in Agent Ops Center dashboard
3. Nathan clicks approve/reject
4. Workflow continues or cancels

### 4.4 Task Queue Partitioning (LOW — Scale)
**Finding:** All workflows use a single task queue (`honey-agents`). As volume grows, a single queue becomes a bottleneck.

**Recommendation:** Split into:
- `honey-health` — health checks, heartbeats (high frequency, low latency)
- `honey-agents` — judge swarms, project scoring (batch, high token)
- `honey-ops` — git-sync, todo-progress (maintenance)

---

## 5. OpenClaw Version Upgrade Path

### 5.1 Current: v2026.3.8 → Available: v2026.3.22

**Key changes in v2026.3.8 → v2026.3.22:**

| Feature | Version | Impact |
|---------|---------|--------|
| `gateway.trustedProxies` config support | 3.12+ | Fixes WebSocket proxy detection (our Task 4) |
| `gateway.controlUi.allowedOrigins` | 3.12+ | Fixes Control UI access behind Railway |
| Slash plugin installs (`feat: add slash plugin installs`) | 3.22 | Install plugins via `/install` command |
| Memory-core independent registration | 3.22 | Memory tools don't fail together |
| Gateway fail-closed on unresolved discovery | 3.22 | Security hardening |
| MiniMax M2.7 alignment | 3.22 | Better MiniMax model support |
| Telegram reply context preservation | 3.22 | Better Telegram integration |
| Windows media path hardening | 3.22 | N/A for Railway |
| SIGTERM shutdown hardening | 3.22 | Better container lifecycle |

**v2026.3.23 is now available** (tagged `v2026.3.23`) with critical fixes:
- OpenRouter auto pricing infinite recursion fix (we use OpenRouter)
- Auth token snap-back bug fix (expired OpenAI tokens reverting)
- MiniMax failover: `api_error` no longer misclassifies billing/auth errors
- Memory-core independent registration (prevents coupled tool failures)
- Gateway lock conflict crash-loop fix (launchd/systemd)
- CSP hardening for Control UI

**Breaking changes to handle on upgrade:**
- `CLAWDBOT_*` and `MOLTBOT_*` env names removed → ensure all use `OPENCLAW_*`
- Plugin SDK changed: `openclaw/extension-api` → `openclaw/plugin-sdk/*`
- `nano-banana-pro` skill removed → use `agents.defaults.imageGenerationModel.primary`
- Agent default timeout raised from 600s to **48 hours** (favorable)
- MiniMax default updated M2.5 → M2.7

**Recommendation:**
1. Try `openclaw.update v2026.3.23` (may fix the build issue from .22)
2. Run `openclaw doctor --fix` after upgrade for cron migration + config repair
3. After upgrade, `gateway.trustedProxies` and `controlUi.allowedOrigins` will persist

### 5.2 Dual Workflow System Architecture

**Important discovery:** Two distinct workflow systems coexist:
1. **Convex Workflows** (`@convex-dev/workflow`) — heartbeat, agentTask, subAgentOrchestration. Runs inside Convex runtime with durable replay.
2. **Temporal** (external) — cronServiceHealthWorkflow, cronJudgeSwarmWorkflow, etc. Runs via temporal-worker service, state synced to Convex `temporalWorkflows` table.

These are NOT competing — they serve different purposes:
- **Convex Workflows** = best for LLM tasks (close to Convex data, reactive subscriptions)
- **Temporal** = best for multi-step orchestration with human-in-the-loop signals, long timeouts, and cross-service coordination

**Recommendation:** Don't consolidate. Use both:
- Convex Workflows for LLM-heavy tasks (agent tasks, heartbeats)
- Temporal for orchestration workflows (judge swarms, scoring pipelines, approval flows)

---

## 6. Cross-Service Integration Opportunities

### 6.1 End-to-End Workflow Pipeline (HIGH — Architecture)
**Vision:** Every agent task follows this pipeline:

```
OpenClaw Cron/User → Temporal Workflow → Execute (with retries)
    → Record in Convex (learnings, metrics, workflow state)
    → Agent Ops Center Dashboard (real-time via Convex subscriptions)
    → n8n Webhook (external notifications, Slack alerts)
```

**Currently missing links:**
- OpenClaw → Temporal (crons still use sub-agent spawns)
- Temporal → n8n (no webhook on workflow completion)
- Convex → Agent Ops Center (dashboard exists but needs Convex deploy alignment)

### 6.2 Redis as Event Bus (MEDIUM — Real-time)
**Finding:** Redis is deployed but only used for "rate limiting, caching" per INFRASTRUCTURE.md. Redis Pub/Sub could enable:
- Real-time service health events (publish on failure, subscribe in dashboard)
- Cross-service coordination (OpenClaw publishes, temporal-worker subscribes)
- Rate limit sharing between gateway and temporal-worker

### 6.3 n8n Integration for External Actions (MEDIUM — Automation)
**Finding:** n8n is deployed at `primary-production-4244.up.railway.app` with webhook support, but no OpenClaw crons trigger n8n workflows.

**Use cases:**
- Judge swarm completes → n8n sends Slack summary
- Service health failure → n8n creates Jira ticket
- Project score drops → n8n sends alert email
- Learning recorded → n8n syncs to Notion/Confluence

### 6.4 Compound Learning Loop Optimization (HIGH — Core Identity)
**Finding:** Per MEMORY.md, the "Compound Intelligence Architecture" is core identity — every task should make the system smarter. Currently:
- Learnings go to Convex `learnings` table ✅
- Learnings NOT fed back into model selection ❌
- Model performance NOT auto-optimized ❌
- No feedback loop from workflow outcomes to cron scheduling ❌

**Recommendation:** Create a Temporal workflow `compoundLearningLoop` that:
1. Queries `modelPerformance.compare()` weekly
2. Identifies best model per task type
3. Updates HEARTBEAT.md cron model assignments automatically
4. Records the decision in `decisions.record()`

This closes the loop: **execution → measurement → optimization → execution**.

---

## 7. Cost Optimization Summary

| Change | Monthly Savings (est.) | Effort |
|--------|----------------------|--------|
| Replace Opus 4.6 with Grok 4 Fast for judge swarms | ~$1,350 | Low |
| Consolidate health checks (3→1 + escalation) | ~$90 | Medium |
| Replace git-sync LLM with shell script | ~$15 | Low |
| Add cost tracking to zero-cost models | $0 (enables future optimization) | Low |
| Route crons through Temporal (retry = no re-runs) | ~$200 | High |
| **Total** | **~$1,655/mo** | |

---

## 8. Priority Implementation Order

1. **Update INFRASTRUCTURE.md** — remove Convex Cloud references (30 min)
2. **Remove GPT-4.1 from models.json** — compliance (5 min)
3. **Consolidate duplicate providers** — minimax, kimi (30 min)
4. **Add Grok 4 Fast to judge swarm config** — biggest cost saving (1 hr)
5. **Wire first cron to Temporal** — service-health as pilot (2 hrs)
6. **Add Convex indexes** — performance (30 min)
7. **Update Agent Ops Center deploy** — prevent Convex overwrite (1 hr)
8. **Add cost data to models** — enable tracking (1 hr)
9. **Build compound learning loop** — core architecture (4 hrs)
10. **OpenClaw upgrade** — when v2026.3.23+ available (1 hr)
