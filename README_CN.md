# OmniAgent

OmniAgent 是一个基于 Mastra 的本地 Agent Runtime，用于承载长期运行、需要工具调用和审批控制的 AI 工作流。当前实现已经从“路由器 + 工具集合”演进为 Runtime/Gateway 架构，包含持久化任务、审批网关、定时调度、Goal 工作区、证据/产物记忆、连接器抽象、评测报告和可选聊天渠道适配器。

## 当前架构

```text
用户 / Channel Gateway / Scheduler
  -> OmniRouterAgent 或 SchedulerRuntime
  -> TaskRuntime / GoalRuntime
  -> Task Dispatcher / Workflow Runner
  -> Tool Gateway / Policy Center / Approval Store
  -> 专用 handler、workflow 或外部 connector
  -> Team Runtime result / inbox / delivery / artifacts
```

核心组件：

- `OmniRouterAgent`：面向用户的路由 Agent。它创建 Runtime/Team task 并读取结果；高风险工作通过 RuntimeTask + Tool Gateway 执行。
- `TaskRuntime`：持久化任务生命周期，支持 `pending`、`waiting_user_confirm`、`running`、`succeeded`、`failed`、`retrying`、`paused` 等状态。
- `Task Dispatcher`：按 `taskType` 分发 pending Runtime Task，覆盖代码任务、定时任务、渠道消息、通知投递和研究 digest 任务。
- `GoalRuntime`：长期任务抽象，包含隔离 goal workspace、run、proof-of-work、retry/reconcile、feedback event 和受预算限制的 goal capsule。
- `Evidence Store`：存储去重后的 evidence，支持评分、排序和 artifact 引用。
- `Artifact Engine`：创建版本化 artifact，支持带 frontmatter 的 Markdown 导出/导入，以及 wiki diff draft。
- `Memory Platform`：包含 context pack、工具输出压缩、SQLite/keyword memory index、profile facets 和 memory consolidation report。
- `Tool Gateway`：工具执行策略边界。它审计调用、脱敏 secret、阻断拒绝操作，并对高风险工具要求 approval token。
- `Tool Policy Center`：只读策略目录，用于查看工具风险、审批和审计姿态，不触碰执行路径。
- `Approval Store`：持久化 approval request，并签发 approval token。
- `Connector Runtime`：把 connector 描述为 tool、memory source、trigger source、profile signal extractor，并提供 scoped credential ref 和 audit event。
- `Model Router`：记录模型路由决策、usage 和预估成本。
- `Eval Harness`：运行场景化评测，按关键词覆盖率打分，并持久化 eval report。
- `Runtime Dashboard`：聚合 runtime task、goal、goal run 和 eval run；Gateway 通过 `GET /runtime/dashboard` 暴露。
- `Agent / Workflow Registry`：静态产品元数据，用于发现 agents/workflows，避免导入 runtime 实例产生副作用。
- `Omni Gateway`：可选 HTTP/OneBot/QQ Bot 渠道层，支持 delivery retry、idempotency、dead-letter、pairing 和 adapter status。

Runtime 资产位于仓库外的 `~/.omni`：长期记忆在 `~/.omni/memory`，run 产物在 `~/.omni/runs`，goal workspace 在 `~/.omni/goals`，gateway session、approval、audit 和 delivery 记录在 `~/.omni/runs/gateway`，eval report 在 `~/.omni/eval-runs`，LibSQL 存储在 `~/.omni/storage`。`docs/` 目录仅用于项目文档。

## 已实现能力

### Runtime Task 与 Gateway

- 持久化 task record 和状态流转。
- Dispatcher lease 与并发控制。
- Tool execution audit log 与脱敏。
- 高风险 capability 的审批请求。
- 定时任务创建、列表、暂停/恢复、删除和 run-now 分发。
- 渠道消息处理、出站投递 retry/dead-letter。

### Goal、Evidence 与 Artifact

- `~/.omni/goals/{goalId}` 下的 Goal workspace manager。
- `GoalRun` 生命周期、event log 和 proof-of-work 文件。
- failed/interrupted/incomplete run 的 retry/reconcile helper。
- 每次 run 前生成 Goal Capsule，避免加载全部历史。
- Feedback event 支持暂停、恢复和 deep-dive 方向调整。
- Evidence 按 URL/content hash 去重，支持 scoring、ranking 和 artifact refs。
- Artifact metadata、Markdown export/import、versioning 和 wiki diff draft。
- Topic research 与 module improvement workflow MVP。

### 产品层元数据

- Runtime dashboard data API：展示 tasks/goals/runs/evals。
- Agent/workflow registry：用于产品发现能力。
- Tool policy center：展示 risk/approval/audit 姿态。
- Eval harness：用于可重复的产品质量检查。

## 前置要求

- Node.js `>=22.13.0`
- npm
- DeepSeek API key，用于当前配置的 Mastra 模型
- 可选：Claude Code CLI（如需 direct code execution）
- 可选：OneBot/NapCat 或官方 QQ Bot 凭据（如需聊天渠道集成）

## 本地启动

1. 安装依赖：

```shell
npm install
```

2. 创建本地环境文件：

```shell
copy .env.example .env
```

PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

3. 编辑 `.env`，至少设置：

```text
DEEPSEEK_API_KEY=sk-...
OMNI_ALLOWED_WORKSPACES=L:\Code
```

4. 启动 Mastra：

```shell
npm run dev
```

Mastra Studio/API 默认运行在 `http://localhost:4111`。

5. 可选：另开终端启动 Omni Gateway：

```shell
npm run gateway
```

Gateway 默认地址：

```text
http://localhost:4120
```

## 验证

推送前运行完整仓库门禁：

```shell
npm run verify
```

该命令会运行 typecheck、测试和 code/docs/tests 同步检查。

如果修改了 runtime wiring 或 Mastra bundle，也运行：

```shell
npm run build
```

当前 runtime 切片常用 focused suites：

```shell
npm test -- --run tests/goal-runtime.test.ts
npm test -- --run tests/eval-harness.test.ts
npm test -- --run tests/runtime-dashboard.test.ts tests/gateway-http-server.test.ts --pool=forks
npm test -- --run tests/registry.test.ts
npm test -- --run tests/tool-policy-center.test.ts tests/tool-gateway.test.ts tests/tool-approval-policy.test.ts
```

## 环境变量

### LLM Provider

- `DEEPSEEK_API_KEY`：DeepSeek-backed Mastra model ids 必需。
- `DEEPSEEK_BASE_URL`：DeepSeek API base URL，通常为 `https://api.deepseek.com`。

### Project 与 Workspace 安全

- `OMNI_PROJECT_ROOT`：可选，显式指定 OmniAgent 项目根目录。通常留空，由应用从 `package.json` 自动发现。
- `OMNI_HOME`：可选，runtime 资产根目录，默认 `~/.omni`。
- `OMNI_ALLOWED_WORKSPACES`：允许 CodeAgent 操作的本地根目录，分号分隔。例如 `L:\Code;D:\Projects`。范围外代码执行会被拒绝。

### Code Execution

- `OMNI_CLAUDE_COMMAND`：启动 Claude Code 的命令。若在 `PATH` 中可填 `claude`，也可填绝对路径。
- `OMNI_CODE_EXECUTION_MODE`：`patch_proposal` 或 `direct`。`patch_proposal` 会写 review artifact，不修改 workspace 文件；`direct` 可在审批后启动 Claude Code。
- `OMNI_CODE_TASK_BACKGROUND_TIMEOUT_MS`：代码任务后台超时。
- `OMNI_CODE_TASK_BACKGROUND_MAX_RETRIES`：代码任务后台重试次数。
- `OMNI_CODE_TASK_BACKGROUND_WAIT_TIMEOUT_MS`：工具调用返回后台任务状态前等待多久。

### Mastra Runtime

- `OMNI_BACKGROUND_GLOBAL_CONCURRENCY`：全局后台任务并发。
- `OMNI_BACKGROUND_PER_AGENT_CONCURRENCY`：单 agent 后台任务并发。
- `OMNI_BACKGROUND_DEFAULT_TIMEOUT_MS`：默认后台任务超时。
- `OMNI_BACKGROUND_MAX_RETRIES`：默认后台重试次数。
- `OMNI_MASTRA_SCHEDULER_TICK_INTERVAL_MS`：Mastra scheduler tick 间隔。

### Omni Runtime Pollers

- `OMNI_CRON_POLL_INTERVAL_MS`：cron schedule 扫描间隔。
- `OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS`：Team Runtime timeout 扫描间隔。
- `OMNI_TASK_DISPATCH_POLL_INTERVAL_MS`：pending Runtime Task dispatch 扫描间隔。
- `OMNI_TASK_DISPATCH_MAX_CONCURRENT`：本地 dispatcher 并发上限。
- `OMNI_TASK_DISPATCH_LEASE_MS`：dispatcher lease 时长，用于减少重复 dispatch。

### Gateway

- `OMNI_API_BASE_URL`：Omni Gateway 调用的 Mastra API base URL。
- `OMNI_GATEWAY_PORT`：Gateway HTTP 端口。
- `OMNI_GATEWAY_DELIVERY_POLL_MS`：delivery worker 轮询间隔。
- `OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS`：进入 `dead_letter` 前的最大投递次数。
- `OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS`：投递失败后的重试延迟。
- `OMNI_GATEWAY_PAIRING_TOKEN`：本地 `/pair <token>` 配对 token。应生成足够长的随机值并保密。
- `OMNI_GATEWAY_ALLOW_SENDERS`：可绕过 pairing 的 sender id，分号分隔。

### OneBot / NapCat

- `OMNI_ONEBOT_HTTP_URL`：OneBot-compatible HTTP API base URL，用于本地 NapCat 或其它 OneBot bridge。留空则禁用 OneBot 发送。

### 官方 QQ Bot

- `OMNI_QQBOT_APPID`：QQ 开放平台 Bot AppID。
- `OMNI_QQBOT_CLIENTSECRET`：同一 Bot 应用的 AppSecret/client secret。

二者留空时禁用官方 QQ Bot adapter。

## Gateway HTTP API

Gateway 运行后可访问：

```shell
curl http://localhost:4120/health
curl http://localhost:4120/runtime/dashboard
curl http://localhost:4120/qqbot/status
curl http://localhost:4120/deliveries
curl http://localhost:4120/deliveries/dead-letter
```

发送渠道消息：

```shell
curl -X POST http://localhost:4120/message \
  -H "Content-Type: application/json" \
  -d '{"senderId":"local","text":"/task L:\\Code\\your-project :: Implement the requested change"}'
```

`/runtime/dashboard` 返回 task、goal、goal-run 和 eval 的聚合状态。`/qqbot/status` 返回适配器配置与连接状态，不暴露凭据。

## 常见本地工作流

### 通过 RuntimeTask 创建代码任务

推荐 payload：

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

当高风险动作需要审批时，Tool Gateway 会在 `~/.omni/runs/gateway/tool-approvals.json` 下记录 approval request。审批后会签发 `approvalToken`，并可把关联 Runtime Task 移回 `pending`。

### 创建并运行 Goal

Goal 是持久化长期工作单元。一个典型 topic research goal 会在自己的 workspace 中保存 evidence、artifact、capsule、run log 和 proof-of-work。

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

### 查看策略与产品元数据

Runtime exports 提供以下产品层入口：

- `readRuntimeDashboardData()`
- `readToolPolicyCenter()`
- `getRegistryCatalog()`
- `runEvalHarness()`

这些接口面向产品 UI/API 层和测试使用。

## 仓库卫生

- 行为变更时，代码、文档和测试一起提交。
- 不提交 `.env`、凭据、日志或本地 runtime state。
- Runtime 资产应放在 `~/.omni`，不进入仓库。
- 高风险执行路径必须保留在 Tool Gateway 和 approval policy 后面。
