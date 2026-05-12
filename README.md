# OmniAgent

OmniAgent is a local Mastra-based agent runtime. The current architecture is no
longer just a router plus several tools; it is a Runtime/Gateway system with
durable task coordination, approval gates, scheduled task dispatch, file-backed
memory, and optional chat-channel adapters.

## Architecture

```text
User / Channel Gateway / Scheduler
  -> OmniRouterAgent or SchedulerRuntime
  -> TaskRuntime
  -> Task Dispatcher
  -> Tool Gateway / Approval Store
  -> Specialist handler or agent
  -> Team Runtime result / inbox / delivery
```

Key components:

- `OmniRouterAgent`: user-facing router. It creates Runtime/Team tasks and
  reads results; it should not directly execute high-risk business tools.
- `TaskRuntime`: user-facing task lifecycle with states such as `pending`,
  `waiting_user_confirm`, `running`, `succeeded`, `failed`, `retrying`, and
  `paused`.
- `Task Dispatcher`: dispatches pending Runtime Tasks by `targetAgentId`.
  Current executable handlers cover `code-agent` and basic `knowledge-agent`
  work.
- `Tool Gateway`: policy boundary for tool execution. It audits calls,
  redacts secrets, blocks denied operations, and requires approval tokens for
  high-risk tools.
- `Approval Store`: persists approval requests and issues approval tokens.
- `SchedulerRuntime/Cron`: creates Runtime Tasks on schedule; it does not
  directly start CodeAgent.
- `CodeAgent`: handles code work. `patch_proposal` mode writes a review
  artifact without changing the workspace.
- `KnowledgeAgent`: maintains file-backed memory and indexes.
- `Omni Gateway`: optional HTTP/OneBot/QQ Bot channel layer with delivery retry,
  idempotency, and dead-letter records.

Runtime assets live outside the repository under `~/.omni`: long-term memory in
`~/.omni/memory`, run artifacts in `~/.omni/runs`, gateway logs in
`~/.omni/gateway`, and LibSQL storage in `~/.omni/storage`. The `docs/`
directory is for project documentation only.

## Prerequisites

- Node.js `>=22.13.0`
- npm
- A DeepSeek API key for the configured Mastra model
- Optional: Claude Code CLI installed and authenticated if you want direct
  code execution
- Optional: OneBot/NapCat or official QQ Bot credentials for channel gateway
  integration

## Local Setup

1. Install dependencies:

```shell
npm install
```

2. Create local environment file:

```shell
copy .env.example .env
```

On PowerShell you can also use:

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

Run these before pushing changes:

```shell
npm run typecheck
npm test
```

Build check:

```shell
npm run build
```

## Environment Variables

### LLM Provider

- `DEEPSEEK_API_KEY`: required for DeepSeek-backed Mastra model ids. Create it
  in the DeepSeek Open Platform API Keys page:
  `https://platform.deepseek.com/api_keys`.
- `DEEPSEEK_BASE_URL`: DeepSeek API base URL. Usually
  `https://api.deepseek.com`.

### Project and Workspace Safety

- `OMNI_PROJECT_ROOT`: optional explicit OmniAgent project root. Usually leave
  empty because the app discovers the root from `package.json`.
- `OMNI_HOME`: optional runtime asset root. Defaults to `~/.omni`.
- `OMNI_ALLOWED_WORKSPACES`: semicolon-separated local roots where CodeAgent is
  allowed to work. Example: `L:\Code;D:\Projects`. Code execution outside
  these roots is rejected.

### Code Execution

- `OMNI_CLAUDE_COMMAND`: command used to start Claude Code. Use `claude` if it
  is on `PATH`, or an absolute executable path.
- `OMNI_CODE_EXECUTION_MODE`: `patch_proposal` or `direct`.
  `patch_proposal` is safer and writes a review artifact without modifying
  workspace files. `direct` can start Claude Code after approval.
- `OMNI_CODE_TASK_BACKGROUND_TIMEOUT_MS`: background timeout for code task
  tools.
- `OMNI_CODE_TASK_BACKGROUND_MAX_RETRIES`: retry count for background code
  tasks.
- `OMNI_CODE_TASK_BACKGROUND_WAIT_TIMEOUT_MS`: how long tool calls wait before
  returning background task status.

### Mastra Runtime

- `OMNI_BACKGROUND_GLOBAL_CONCURRENCY`: global background task concurrency.
- `OMNI_BACKGROUND_PER_AGENT_CONCURRENCY`: per-agent background task
  concurrency.
- `OMNI_BACKGROUND_DEFAULT_TIMEOUT_MS`: default background task timeout.
- `OMNI_BACKGROUND_MAX_RETRIES`: default background retry count.
- `OMNI_MASTRA_SCHEDULER_TICK_INTERVAL_MS`: Mastra scheduler tick interval.

### Omni Runtime Pollers

- `OMNI_CRON_POLL_INTERVAL_MS`: cron schedule scan interval.
- `OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS`: Team Runtime timeout scan interval.
- `OMNI_TASK_DISPATCH_POLL_INTERVAL_MS`: pending Runtime Task dispatch scan
  interval.
- `OMNI_TASK_DISPATCH_MAX_CONCURRENT`: local dispatcher concurrency cap.
- `OMNI_TASK_DISPATCH_LEASE_MS`: dispatcher lease duration to reduce duplicate
  dispatch.

### Gateway

- `OMNI_API_BASE_URL`: Mastra API base URL used by Omni Gateway.
- `OMNI_GATEWAY_PORT`: HTTP port for the gateway.
- `OMNI_GATEWAY_DELIVERY_POLL_MS`: gateway delivery worker poll interval.
- `OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS`: max delivery attempts before
  `dead_letter`.
- `OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS`: retry delay after failed delivery.
- `OMNI_GATEWAY_PAIRING_TOKEN`: local pairing token for `/pair <token>`.
  Generate a long random value and keep it private.
- `OMNI_GATEWAY_ALLOW_SENDERS`: semicolon-separated sender ids that bypass
  pairing.

### OneBot / NapCat

- `OMNI_ONEBOT_HTTP_URL`: OneBot-compatible HTTP API base URL. Use this for
  local NapCat or other OneBot bridges. In NapCat, enable an HTTP server and
  copy its base URL, for example `http://127.0.0.1:3000`. Leave empty to
  disable OneBot sending.

### Official QQ Bot

- `OMNI_QQBOT_APPID`: AppID from QQ Open Platform after creating a bot:
  `https://q.qq.com/`.
- `OMNI_QQBOT_CLIENTSECRET`: AppSecret/client secret from the same bot
  application.

The adapter exchanges these values for an access token through QQ Bot APIs.
Leave both empty to disable the official QQ Bot adapter.

## Common Local Workflows

Create a scheduled task through CronAgent tools or the UI. Cron creates a
Runtime Task, then Task Dispatcher routes it.

Create code work as a Runtime Task targeting `code-agent`. Prefer payload:

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

When a high-risk action needs approval, Tool Gateway records an approval request
under `~/.omni/runs/gateway/tool-approvals.json`. Approving the request issues an
`approvalToken` and can move the linked Runtime Task back to `pending`.

## Repository Hygiene

- Commit code, docs, and tests together when behavior changes.
- Do not commit `.env`, credentials, logs, or local `.omc` runtime state.
- Runtime assets belong under `~/.omni`, not in this repository.
