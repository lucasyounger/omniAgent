# OmniAgent

OmniAgent is a local Mastra-based agent runtime for long-running, tool-using AI work. It combines a Runtime/Gateway architecture with durable tasks, approvals, scheduled dispatch, goal workspaces, evidence/artifact memory, connector abstractions, evaluation reports, and optional chat-channel adapters.

## Current Architecture

```text
User / Channel Gateway / Scheduler
  -> OmniRouterAgent or SchedulerRuntime
  -> TaskRuntime / GoalRuntime
  -> Task Dispatcher / Workflow Runner
  -> Tool Gateway / Policy Center / Approval Store
  -> Specialist handler, workflow, or external connector
  -> Team Runtime result / inbox / delivery / artifacts
```

Key components:

- `OmniRouterAgent`: user-facing router. It creates Runtime/Team tasks and reads results; high-risk work goes through RuntimeTask + Tool Gateway.
- `TaskRuntime`: durable task lifecycle with states such as `pending`, `waiting_user_confirm`, `running`, `succeeded`, `failed`, `retrying`, and `paused`.
- `Task Dispatcher`: dispatches pending Runtime Tasks by `taskType`, including code tasks, schedule tasks, channel messages, notification delivery, and research digest tasks.
- `GoalRuntime`: durable long-task abstraction with isolated goal workspaces, runs, proof-of-work, retries, reconciliation, feedback events, and budgeted goal capsules.
- `Evidence Store`: stores deduplicated evidence records, ranks evidence, and supports artifact references.
- `Artifact Engine`: creates versioned artifacts, exports/ingests Markdown with frontmatter, and builds wiki diff drafts.
- `Memory Platform`: includes context packs, tool-output compression, SQLite/keyword memory index, profile facets, and memory consolidation reports.
- `Tool Gateway`: policy boundary for tool execution. It audits calls, redacts secrets, blocks denied operations, and requires approval tokens for high-risk tools.
- `Tool Policy Center`: read-only policy catalog for inspecting tool risk, approval, and audit posture without touching execution paths.
- `Approval Store`: persists approval requests and issues approval tokens.
- `Connector Runtime`: describes connectors as tools, memory sources, trigger sources, and profile signal extractors, with scoped credential references and audit events.
- `Model Router`: records model routing decisions, usage, and estimated costs.
- `Eval Harness`: runs scenario-based evaluations, scores keyword coverage, and persists eval reports.
- `Runtime Dashboard`: aggregates runtime tasks, goals, goal runs, and eval runs. The gateway exposes it at `GET /runtime/dashboard`.
- `Agent / Workflow Registry`: static product metadata for discovering agents and workflows without importing runtime instances.
- `Omni Gateway`: optional HTTP/OneBot/QQ Bot channel layer with delivery retry, idempotency, dead-letter records, pairing, and adapter status inspection.

Runtime assets live outside the repository under `~/.omni`: long-term memory in `~/.omni/memory`, run artifacts in `~/.omni/runs`, goal workspaces in `~/.omni/goals`, gateway sessions, approvals, audits, and delivery records in `~/.omni/runs/gateway`, eval reports in `~/.omni/eval-runs`, and LibSQL storage in `~/.omni/storage`. The `docs/` directory is for project documentation only.

## Implemented Runtime Capabilities

### Runtime Tasks and Gateway

- Durable task records and state transitions.
- Dispatcher leases and concurrency controls.
- Tool execution audit logs and redaction.
- Approval requests for dangerous capabilities.
- Scheduled task creation, listing, pause/resume, deletion, and run-now dispatch.
- Channel message handling and outbound delivery retry/dead-letter tracking.

### Goals, Evidence, and Artifacts

- Goal workspace manager under `~/.omni/goals/{goalId}`.
- `GoalRun` lifecycle with event logs and proof-of-work files.
- Retry/reconcile helpers for failed, interrupted, or incomplete runs.
- Goal capsules generated before runs to avoid loading full history.
- Feedback events that can pause/resume/deepen goal work.
- Evidence deduplication by URL/content hash, scoring, ranking, and artifact refs.
- Artifact metadata, Markdown export/import, versioning, and wiki diff drafts.
- Topic research and module-improvement workflow MVPs.

### Product Surface Metadata

- Runtime dashboard data API for tasks/goals/runs/evals.
- Agent/workflow registry for product discovery.
- Tool policy center for risk/approval/audit posture.
- Eval harness for repeatable product-quality checks.

## Prerequisites

- Node.js `>=22.13.0`
- npm
- A DeepSeek API key for the configured Mastra model
- Optional: Claude Code CLI installed and authenticated for direct code execution
- Optional: OneBot/NapCat or official QQ Bot credentials for channel gateway integration

## Local Setup

1. Install dependencies:

```shell
npm install
```

2. Create a local environment file:

```shell
copy .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Edit `.env` and at minimum set:

```text
DEEPSEEK_API_KEY=sk-...
OMNI_ALLOWED_WORKSPACES=L:\Code
```

4. Start Mastra:

```shell
npm run dev
```

Mastra Studio/API runs at `http://localhost:4111` by default.

5. Optional: start Omni Gateway in another terminal:

```shell
npm run gateway
```

Gateway default URL:

```text
http://localhost:4120
```

## Verification

Run the full repository gate before pushing changes:

```shell
npm run verify
```

This runs typecheck, tests, and the code/docs/tests sync guard.

For runtime wiring or Mastra bundle changes, also run:

```shell
npm run build
```

Focused suites used by the current runtime slices include:

```shell
npm test -- --run tests/goal-runtime.test.ts
npm test -- --run tests/eval-harness.test.ts
npm test -- --run tests/runtime-dashboard.test.ts tests/gateway-http-server.test.ts --pool=forks
npm test -- --run tests/registry.test.ts
npm test -- --run tests/tool-policy-center.test.ts tests/tool-gateway.test.ts tests/tool-approval-policy.test.ts
```

## Environment Variables

### LLM Provider

- `DEEPSEEK_API_KEY`: required for DeepSeek-backed Mastra model ids.
- `DEEPSEEK_BASE_URL`: DeepSeek API base URL. Usually `https://api.deepseek.com`.

### Project and Workspace Safety

- `OMNI_PROJECT_ROOT`: optional explicit OmniAgent project root. Usually leave empty because the app discovers the root from `package.json`.
- `OMNI_HOME`: optional runtime asset root. Defaults to `~/.omni`.
- `OMNI_ALLOWED_WORKSPACES`: semicolon-separated local roots where CodeAgent is allowed to work. Example: `L:\Code;D:\Projects`. Code execution outside these roots is rejected.

### Code Execution

- `OMNI_CLAUDE_COMMAND`: command used to start Claude Code. Use `claude` if it is on `PATH`, or an absolute executable path.
- `OMNI_CODE_EXECUTION_MODE`: `patch_proposal` or `direct`. `patch_proposal` writes a review artifact without modifying workspace files. `direct` can start Claude Code after approval.
- `OMNI_CODE_TASK_BACKGROUND_TIMEOUT_MS`: background timeout for code task tools.
- `OMNI_CODE_TASK_BACKGROUND_MAX_RETRIES`: retry count for background code tasks.
- `OMNI_CODE_TASK_BACKGROUND_WAIT_TIMEOUT_MS`: how long tool calls wait before returning background task status.

### Mastra Runtime

- `OMNI_BACKGROUND_GLOBAL_CONCURRENCY`: global background task concurrency.
- `OMNI_BACKGROUND_PER_AGENT_CONCURRENCY`: per-agent background task concurrency.
- `OMNI_BACKGROUND_DEFAULT_TIMEOUT_MS`: default background task timeout.
- `OMNI_BACKGROUND_MAX_RETRIES`: default background retry count.
- `OMNI_MASTRA_SCHEDULER_TICK_INTERVAL_MS`: Mastra scheduler tick interval.

### Omni Runtime Pollers

- `OMNI_CRON_POLL_INTERVAL_MS`: cron schedule scan interval.
- `OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS`: Team Runtime timeout scan interval.
- `OMNI_TASK_DISPATCH_POLL_INTERVAL_MS`: pending Runtime Task dispatch scan interval.
- `OMNI_TASK_DISPATCH_MAX_CONCURRENT`: local dispatcher concurrency cap.
- `OMNI_TASK_DISPATCH_LEASE_MS`: dispatcher lease duration to reduce duplicate dispatch.

### Gateway

- `OMNI_API_BASE_URL`: Mastra API base URL used by Omni Gateway.
- `OMNI_GATEWAY_PORT`: HTTP port for the gateway.
- `OMNI_GATEWAY_DELIVERY_POLL_MS`: gateway delivery worker poll interval.
- `OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS`: max delivery attempts before `dead_letter`.
- `OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS`: retry delay after failed delivery.
- `OMNI_GATEWAY_PAIRING_TOKEN`: local pairing token for `/pair <token>`. Generate a long random value and keep it private.
- `OMNI_GATEWAY_ALLOW_SENDERS`: semicolon-separated sender ids that bypass pairing.

### OneBot / NapCat

- `OMNI_ONEBOT_HTTP_URL`: OneBot-compatible HTTP API base URL. Use this for local NapCat or other OneBot bridges. Leave empty to disable OneBot sending.

### Official QQ Bot

- `OMNI_QQBOT_APPID`: AppID from QQ Open Platform after creating a bot.
- `OMNI_QQBOT_CLIENTSECRET`: AppSecret/client secret from the same bot application.

Leave both empty to disable the official QQ Bot adapter.

## Gateway HTTP API

When the gateway is running:

```shell
curl http://localhost:4120/health
curl http://localhost:4120/runtime/dashboard
curl http://localhost:4120/qqbot/status
curl http://localhost:4120/deliveries
curl http://localhost:4120/deliveries/dead-letter
```

Post a channel message:

```shell
curl -X POST http://localhost:4120/message \
  -H "Content-Type: application/json" \
  -d '{"senderId":"local","text":"/task L:\\Code\\your-project :: Implement the requested change"}'
```

`/runtime/dashboard` returns aggregate task, goal, goal-run, and eval status data. `/qqbot/status` reports adapter configuration and connection state without exposing credentials.

## Common Local Workflows

### Create code work through RuntimeTask

Prefer payloads like:

```json
{
  "taskType": "code.claude_code_task",
  "payload": {
    "workspacePath": "L:\\Code\\your-project",
    "objective": "Implement the requested change",
    "executionMode": "patch_proposal"
  }
}
```

When a high-risk action needs approval, Tool Gateway records an approval request under `~/.omni/runs/gateway/tool-approvals.json`. Approving the request issues an `approvalToken` and can move the linked Runtime Task back to `pending`.

### Create and run goals

Goals are durable long-running work units. A typical topic research goal stores evidence, artifacts, capsules, run logs, and proof-of-work under its goal workspace.

```ts
await createGoal({
  id: 'context-engineering-research',
  type: 'topic_research',
  title: 'Context Engineering Research',
  objective: 'Track context engineering, memory, retrieval, compression, and agent workflows.',
  sources: ['github', 'rss', 'blogs', 'arxiv'],
  artifactPolicy: ['daily_digest', 'wiki', 'memory_proposal'],
  feedbackPolicy: 'manual',
});
```

### Inspect policy and product metadata

Use the runtime exports to inspect:

- `readRuntimeDashboardData()`
- `readToolPolicyCenter()`
- `getRegistryCatalog()`
- `runEvalHarness()`

These surfaces are intended for product UI/API layers and tests.

## Repository Hygiene

- Commit code, docs, and tests together when behavior changes.
- Do not commit `.env`, credentials, logs, or local runtime state.
- Runtime assets belong under `~/.omni`, not in this repository.
- Keep high-risk execution paths behind Tool Gateway and approval policies.
