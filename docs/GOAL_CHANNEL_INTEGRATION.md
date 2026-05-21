# Goal Channel Integration — 4+1 Design & Implementation Plan

> 打通 QQbot / 自然语言 → Goal 创建 → Goal Workflow 执行 → 反馈闭环的完整链路

## 0. 现状 Gap

| 层 | 现有 | 缺失 |
|---|---|---|
| 自然语言意图 | schedule / notify / research / status 共 10 种 | `goal.create` / `goal.run` / `goal.list` / `goal.feedback` |
| 斜杠命令 | `/task` / `/pr` / `/pair` / `/help` / `/status` | `/goal` 命令族 |
| Task Type | 20 种 runtimeTaskType | `goal.*` 系列 |
| Task Dispatcher | 9 个 handler 分支 | `goal-handler` 分支 |
| Agent Tool | 24 个 tool，0 个 goal 相关 | `goalTools` |
| Agent 指令 | OmniRouterAgent 无 goal 路由规则 | Goal 路由与委派指令 |
| Mastra 注册 | 0 个 Goal Workflow 注册 | 两个 Goal Workflow 注册 |
| 反馈闭环 | Feedback Schema + Store 存在，但未接入消息通道 | QQ → feedback → goal 状态变更 |

---

## 1. Logical View（逻辑视图）

### 1.1 新增抽象

```
┌────────────────────────────────────────────────────────────────┐
│                    GoalChannelRequest                            │
│  type: 'create' | 'run' | 'list' | 'status' | 'feedback'      │
│  goalId?: string                                                │
│  goalType?: GoalType                                            │
│  title?: string                                                 │
│  objective?: string                                             │
│  scope?: string[]                                               │
│  moduleName?: string                                            │
│  feedbackText?: string                                          │
│  source: ChannelSource                                          │
│  notifyTarget: ChannelTarget                                    │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 完整类型关系图

```
                        ┌──────────────────────────────┐
                        │       ChannelMessage          │
                        │  (QQ / OneBot / HTTP / CLI)   │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │       Orchestrator            │
                        │  + goal.create / goal.run /   │
                        │    goal.list / goal.feedback  │
                        └──────┬──────────┬────────────┘
                               │          │
                 deterministic │          │ LLM fallback
                 route         │          │
                               ▼          ▼
               ┌───────────────────┐  ┌──────────────────┐
               │  RuntimeTask      │  │  OmniRouterAgent  │
               │  taskType=        │  │  + goalTools      │
               │  goal.create /    │  │  + goal routing   │
               │  goal.run /       │  │    instructions   │
               │  goal.list /      │  └──────────────────┘
               │  goal.feedback    │
               └───────┬───────────┘
                       │
              ┌────────▼────────┐
              │ TaskDispatcher   │
              │ + goal-handler  │
              └────┬───────┬────┘
                   │       │
         ┌─────────▼──┐  ┌─▼──────────────┐
         │  Goal       │  │  Goal Workflow  │
         │  Store      │  │  (registered   │
         │  create /   │  │   in Mastra)   │
         │  read /     │  └───────┬────────┘
         │  list /     │          │
         │  status     │  ┌───────▼────────┐
         └─────────┬──┘  │  Artifacts      │
                   │     │  + PR Pool      │
                   │     │  + Notification │
                   │     └───────┬────────┘
                   │             │
              ┌────▼─────────────▼────┐
              │    Feedback Loop      │
              │  QQ/feishu → feedback │
              │  → goal pause/resume  │
              │  → next run context   │
              └───────────────────────┘
```

### 1.3 新增 Task Types

| Task Type | Default Agent | Handler | Description |
|-----------|--------------|---------|-------------|
| `goal.create` | `goal-runtime` | `goal-handler` | 创建 Goal 记录及 workspace |
| `goal.run` | `goal-runtime` | `goal-handler` | 执行一次 Goal Run（触发对应 workflow） |
| `goal.list` | `goal-runtime` | `goal-handler` | 列出 Goal 及其 Run 状态 |
| `goal.status` | `goal-runtime` | `goal-handler` | 查询单个 Goal 详情 |
| `goal.feedback` | `goal-runtime` | `goal-handler` | 记录反馈并应用状态变更 |

### 1.4 新增 Orchestrator Intent

| Intent | Confidence | 映射 TaskType | 触发模式 |
|--------|-----------|---------------|---------|
| `goal.create` | 0.90 | `goal.create` | "创建/新建一个改进目标" / "帮我分析 memory 模块" |
| `goal.run` | 0.88 | `goal.run` | "运行/执行目标 xxx" |
| `goal.list` | 0.90 | `goal.list` | "列出/查看目标" |
| `goal.status` | 0.88 | `goal.status` | "目标 xxx 什么状态" |
| `goal.feedback` | 0.85 | `goal.feedback` | "暂停/继续/深入分析目标 xxx" |

---

## 2. Process View（过程视图）

### 2.1 完整端到端流程

```
QQ/CLI/HTTP
    │
    ▼
ChannelMessage
    │
    ├─ /goal create ──────────────────────┐
    ├─ /goal run ─────────────────────────┤
    ├─ /goal list ────────────────────────┤
    ├─ /goal status ──────────────────────┤
    ├─ /goal feedback ────────────────────┤
    │                                      │
    ▼                                      │
orchestrateChannelMessage()                │
    │                                      │
    ├─ deterministic match ────────┐       │
    │  (regex + keyword)          │       │
    │                              │       │
    ├─ passthrough ──► OmniRouter  │       │
    │                  Agent       │       │
    │                  + goalTools │       │
    │                              │       │
    ▼                              ▼       │
OrchestratorDecision              Agent    │
kind='runtime_task'               Decision │
    │                              │       │
    ▼                              ▼       │
taskRuntime.createTask()         同上     │
    │                                      │
    ▼ ◄────────────────────────────────────┘
dispatchRuntimeTask()
    │
    ├─ taskType === 'goal.create'
    │    └─► dispatchGoalCreateTask()
    │         ├─ parseGoalChannelRequest()
    │         ├─ createGoal()
    │         ├─ (optional) createGoalRun() + runWorkflow()
    │         └─ notifyResult()
    │
    ├─ taskType === 'goal.run'
    │    └─► dispatchGoalRunTask()
    │         ├─ readGoal()
    │         ├─ route to correct workflow by goal.type
    │         ├─ runModuleImprovementGoalWorkflow() / runTopicResearchGoalWorkflow()
    │         └─ notifyResult()
    │
    ├─ taskType === 'goal.list'
    │    └─► dispatchGoalListTask()
    │         ├─ listGoals()
    │         └─ formatGoalList()
    │
    ├─ taskType === 'goal.status'
    │    └─► dispatchGoalStatusTask()
    │         ├─ readGoal()
    │         ├─ readGoalRun() (latest)
    │         └─ formatGoalStatus()
    │
    └─ taskType === 'goal.feedback'
         └─► dispatchGoalFeedbackTask()
              ├─ recordRawFeedback()
              ├─ (auto) pauseGoal / resumeGoal
              └─ notifyFeedbackAck()
```

### 2.2 `/goal create` 详细序列

```
User: "帮我创建一个模块改进目标，改进 memory 模块"
  │
  ▼ orchestrator 识别 goal.create intent
  │
  ▼ taskRuntime.createTask()
  │  taskType: 'goal.create'
  │  payload: { goalType: 'module_improvement', title: 'Memory Module Improvement',
  │             objective: '探索 GitHub 热点仓库，输出改进设计文档和落地计划',
  │             scope: ['src/mastra/runtime/memory/'] }
  │
  ▼ dispatchGoalCreateTask()
  │  1. generateGoalId() → "memory-improvement"
  │  2. createGoal({ id, type, title, objective, scope })
  │  3. (可选) 自动触发首次 run:
  │     createGoalRun() → runModuleImprovementGoalWorkflow()
  │  4. 构造回复消息
  │
  ▼ 回复用户:
  "已创建模块改进目标 [memory-improvement]。
   目标：探索 GitHub 热点仓库，输出改进设计文档和落地计划。
   已自动启动首次分析 Run [run-001]。
   完成后将推送结果摘要。"
```

### 2.3 `/goal feedback` → 反馈闭环

```
User: "暂停 memory-improvement 目标"
  │
  ▼ orchestrator 识别 goal.feedback intent
  │
  ▼ dispatchGoalFeedbackTask()
  │  1. recordRawFeedback({ goalId, channel, rawMessage })
  │  2. parseFeedbackMessage() → intent='pause'
  │  3. applyFeedbackStateChange() → pauseGoal()
  │  4. 回复确认
  │
  ▼ Goal status → paused
```

### 2.4 Workflow 执行 + 结果推送

```
GoalRun 执行完成
  │
  ▼ completeGoalRun()
  │
  ├─ 生成 proof-of-work.md
  │
  ▼ (可选) 创建 notify task
  │  taskType: 'notify.send_channel_message'
  │  payload: { text: digest, target: notifyTarget }
  │
  ▼ dispatchRuntimeTask()
  │
  ▼ 用户在 QQ 收到推送摘要
```

### 2.5 并发与状态

- Goal 创建和 Run 执行在同一次 dispatch 中串行完成
- 多个 Goal 可并行执行（受 `OMNI_TASK_DISPATCH_MAX_CONCURRENT` 限制）
- Feedback 解析为同步纯函数，状态变更为异步 I/O
- Workflow 内部 repo 读取并行（已有 `Promise.all`）

---

## 3. Development View（开发视图）

### 3.1 新增/修改文件清单

```
src/mastra/
├── runtime/
│   ├── task-types.ts                          # ① 新增 5 个 goal.* taskType
│   ├── task-dispatcher.ts                     # ② 新增 goal-handler 分支 + 5 个 dispatch 函数
│   ├── orchestrator.ts                        # ③ 新增 goal.* intent 识别 + 关键词匹配
│   ├── goal/
│   │   ├── goal-list.ts                       # ④ 新增 listGoals() 函数
│   │   └── goal-id.ts                         # ⑤ 新增 generateGoalId() 函数
│   └── goal-channel/
│       ├── index.ts                           # ⑥ 桶导出
│       ├── goal-channel-request.ts            # ⑦ GoalChannelRequest 类型 + 解析
│       └── goal-channel-formatter.ts          # ⑧ 格式化输出（给用户看）
│
├── tools/
│   ├── goal-tools.ts                          # ⑨ 新增 goalTools (Mastra Tools)
│   └── index.ts                               # ⑩ 新增 goal-tools 导出
│
├── agents/
│   ├── omni-router-agent.ts                   # ⑪ 添加 goalTools + goal 路由指令
│   └── goal-agent.ts                          # ⑫ 新增 GoalAgent (可选，MVP 用 dispatcher)
│
├── workflows/
│   ├── index.ts                               # ⑬ 新增 goal workflow 导出
│   └── module-improvement-goal-workflow.ts    # ⑭ 添加 notifyTarget 参数支持
│
├── index.ts                                   # ⑮ 注册 goal workflows
│
└── registry/
    └── registry.ts                            # ⑯ 更新 capabilities

src/gateway/
├── message-handler.ts                         # ⑰ 新增 /goal 命令处理
└── http-server.ts                             # ⑱ 新增 /goals REST 端点（可选）

tests/
└── goal-channel.test.ts                       # ⑲ 端到端测试
```

### 3.2 依赖变更图

```
goal-tools.ts ──► goal-store.ts, goal-run-store.ts, goal-list.ts
goal-channel-request.ts ──► goal.schema.ts
goal-channel-formatter.ts ──► Goal, GoalRun
task-dispatcher.ts ──► goal-channel/*, goal-list.ts, goal-id.ts
orchestrator.ts ──► goal-channel-request.ts (类型引用)
message-handler.ts ──► goal-channel-request.ts
omni-router-agent.ts ──► goal-tools.ts
```

### 3.3 分层约束

- `goal-channel/` 仅依赖 `goal.schema` 和 `goal-store`，不依赖 workflow
- `goal-tools` 可调用 `goal-store` + `goal-run-store`，但**不直接调用** workflow
- Workflow 触发统一走 `task-dispatcher → goal.run` 路径
- `orchestrator` 不依赖 `goal-store`，仅做文本匹配

---

## 4. Physical View（物理视图）

### 4.1 运行时文件布局（新增部分）

```
~/.omni/
├── goals/
│   └── {goalId}/
│       ├── goal.json                  # 已有
│       ├── capsule.md                 # 已有
│       ├── feedback.jsonl             # 已有
│       ├── event-log.jsonl            # 已有
│       └── runs/
│           └── {runId}/               # 已有
│
├── pr-pool/                           # 已有
│
├── runtime-tasks/                     # 已有，新增 goal.* taskType 记录
│
└── team/                              # 已有，新增 goal-handler 事件
```

### 4.2 HTTP 端点（可选）

| Method | Path | Description |
|--------|------|-------------|
| POST | `/goals` | 创建 Goal |
| GET | `/goals` | 列出 Goals |
| GET | `/goals/:goalId` | 查看 Goal 详情 |
| POST | `/goals/:goalId/runs` | 触发 Goal Run |
| POST | `/goals/:goalId/feedback` | 提交反馈 |

### 4.3 QQ 命令

```
/goal create <type> <title> :: <objective> [--scope path1,path2]
/goal run <goalId> [--module name]
/goal list [--status active|paused|completed]
/goal status <goalId>
/goal feedback <goalId> <text>
```

### 4.4 自然语言触发词

| 意图 | 中文触发词 | 英文触发词 |
|------|-----------|-----------|
| goal.create | 创建目标/新建改进目标/帮我分析xx模块 | create a goal/improve module xx |
| goal.run | 运行目标/执行分析/跑一次 | run goal/execute analysis |
| goal.list | 列出目标/查看所有目标 | list goals/show goals |
| goal.status | 目标xxx什么状态/目标进度 | goal status/progress |
| goal.feedback | 暂停目标/继续目标/深入分析 | pause/resume/deep dive goal |

---

## 5. Scenarios（场景视图）

### 场景 1：QQ 中通过自然语言创建并运行 module_improvement Goal

| 步骤 | 用户 | 系统 |
|------|------|------|
| 1 | 发送 "帮我创建一个模块改进目标，改进 memory 模块，关注 src/mastra/runtime/memory/ 目录" | Orchestrator 匹配 `goal.create` intent，提取 goalType=module_improvement, title="Memory Module Improvement", scope=["src/mastra/runtime/memory/"] |
| 2 | | Dispatcher 调用 `createGoal()`，goalId="memory-improvement" |
| 3 | | 自动创建 `goal.run` task，触发 `runModuleImprovementGoalWorkflow()` |
| 4 | 收到回复 "已创建目标 memory-improvement，正在执行首次分析" | |
| 5 | | Workflow 完成，创建 notify task |
| 6 | 收到推送 "memory-improvement 分析完成：2个候选repo，3个gap，1个PR草稿" | |

### 场景 2：通过 /goal 命令精确创建

| 步骤 | 用户 | 系统 |
|------|------|------|
| 1 | "/goal create module_improvement Memory Module Improvement :: 探索 GitHub 热点仓库，输出改进设计文档 --scope src/mastra/runtime/memory/" | 解析命令参数 |
| 2 | | 创建 Goal，返回 goalId |
| 3 | "/goal run memory-improvement --module memory" | 触发 Workflow |
| 4 | 收到回复 "Run run-001 已启动" | |

### 场景 3：查看目标状态

| 步骤 | 用户 | 系统 |
|------|------|------|
| 1 | "memory-improvement 目标什么进度" | Orchestrator 匹配 `goal.status` |
| 2 | | 读取 goal + latest run |
| 3 | 收到 "目标 memory-improvement | active | 1次Run(succeeded) | 6个产物 | 1个PR草稿" | |

### 场景 4：反馈闭环

| 步骤 | 用户 | 系统 |
|------|------|------|
| 1 | "暂停 memory-improvement 目标" | Orchestrator 匹配 `goal.feedback`，intent=pause |
| 2 | | `recordRawFeedback()` → `pauseGoal()` |
| 3 | 收到 "目标 memory-improvement 已暂停" | |
| 4 | (稍后) "继续运行 memory-improvement" | Orchestrator 匹配 `goal.feedback`，intent=resume |
| 5 | | `recordRawFeedback()` → `resumeGoal()` |
| 6 | 收到 "目标 memory-improvement 已恢复" | |

### 场景 5：OmniRouterAgent 通过 tool 创建 Goal

| 步骤 | 用户 | 系统 |
|------|------|------|
| 1 | "我想改进 memory 模块，帮我看看有哪些可以参考的开源项目" | 消息落入 passthrough → OmniRouterAgent |
| 2 | | Agent 调用 `createGoalTool` |
| 3 | | Agent 调用 `runGoalTool` |
| 4 | 收到 Agent 整理后的回复 | |

---

## Implementation Plan（落地计划）

### Phase 1：Goal Task Type + Dispatcher（核心打通）

**目标**：从 Task 层面支持 Goal 的创建、执行、查询、反馈

| # | 任务 | 文件 | 估时 |
|---|------|------|------|
| 1.1 | 新增 5 个 `goal.*` taskType 及注册 | `src/mastra/runtime/task-types.ts` | 0.5h |
| 1.2 | 新增 `goal-list.ts`：`listGoals()` 扫描 ~/.omni/goals/ 目录 | `src/mastra/runtime/goal/goal-list.ts` | 0.5h |
| 1.3 | 新增 `goal-id.ts`：`generateGoalId()` 基于 title 生成 ID | `src/mastra/runtime/goal/goal-id.ts` | 0.5h |
| 1.4 | 新增 `goal-channel/` 模块：请求类型 + 解析 + 格式化 | `src/mastra/runtime/goal-channel/` | 1h |
| 1.5 | TaskDispatcher 新增 `goal-handler` 5 个 dispatch 函数 | `src/mastra/runtime/task-dispatcher.ts` | 2h |
| 1.6 | 编写 dispatcher 层单元测试 | `tests/goal-channel.test.ts` | 1h |

**验收标准**：
- `dispatchRuntimeTask()` 能处理 5 种 goal.* taskType
- `goal.create` 能创建 Goal 记录并写入 workspace
- `goal.run` 能路由到正确的 workflow 并执行
- `goal.list` 能返回 Goal 列表
- `goal.feedback` 能记录反馈并应用状态变更

### Phase 2：Orchestrator + /goal 命令（入口打通）

**目标**：用户通过 QQ 自然语言和斜杠命令触发 Goal 操作

| # | 任务 | 文件 | 估时 |
|---|------|------|------|
| 2.1 | Orchestrator 新增 5 个 goal.* intent 识别 | `src/mastra/runtime/orchestrator.ts` | 1.5h |
| 2.2 | message-handler 新增 `/goal` 命令处理 | `src/gateway/message-handler.ts` | 1.5h |
| 2.3 | 更新 `/help` 帮助文本 | `src/gateway/message-handler.ts` | 0.5h |
| 2.4 | 编写 orchestrator + message-handler 测试 | `tests/goal-channel.test.ts` | 1h |

**验收标准**：
- "帮我创建一个模块改进目标" → 识别为 `goal.create`
- `/goal create module_improvement Memory :: 改进 --scope src/xxx` → 正确解析
- `/goal list` → 返回 Goal 列表
- "暂停目标 xxx" → 识别为 `goal.feedback` with intent=pause

### Phase 3：Goal Tools + Agent 集成（LLM 路由打通）

**目标**：OmniRouterAgent 能通过 tool 创建和管理 Goal

| # | 任务 | 文件 | 估时 |
|---|------|------|------|
| 3.1 | 新增 `goal-tools.ts`：5 个 Mastra Tool | `src/mastra/tools/goal-tools.ts` | 2h |
| 3.2 | 导出 goal-tools | `src/mastra/tools/index.ts` | 0.5h |
| 3.3 | OmniRouterAgent 添加 goalTools + goal 路由指令 | `src/mastra/agents/omni-router-agent.ts` | 1h |
| 3.4 | 注册 Goal Workflows 到 Mastra 实例 | `src/mastra/index.ts` | 0.5h |
| 3.5 | Workflow 添加 notifyTarget 支持 | `src/mastra/workflows/module-improvement-goal-workflow.ts` | 0.5h |
| 3.6 | 编写 goal-tools 测试 | `tests/goal-channel.test.ts` | 1h |

**验收标准**：
- OmniRouterAgent 能调用 `createGoalTool` 创建 Goal
- OmniRouterAgent 能调用 `runGoalTool` 触发 Workflow
- Goal Workflow 执行完成后能推送摘要到原始 channel
- 两个 Goal Workflow 已注册到 Mastra

### Phase 4：端到端验证 + 文档

**目标**：全链路可用

| # | 任务 | 文件 | 估时 |
|---|------|------|------|
| 4.1 | 端到端测试：QQ 消息 → Goal 创建 → Run → 推送 | `tests/goal-channel.test.ts` | 1h |
| 4.2 | 端到端测试：/goal 命令全流程 | `tests/goal-channel.test.ts` | 1h |
| 4.3 | 更新 GOAL_RUNTIME.md 文档 | `docs/GOAL_RUNTIME.md` | 0.5h |
| 4.4 | 更新 ARCHITECTURE.md 注册状态 | `docs/ARCHITECTURE.md` | 0.5h |
| 4.5 | typecheck + 全量测试通过 | - | 0.5h |

**验收标准**：
- `npm run typecheck` 通过
- `npm test` 全量通过
- QQ 发送自然语言 → 创建 Goal → 执行 Run → 收到推送摘要
- `/goal` 命令全流程可用

### 总估时

| Phase | 估时 | 风险 |
|-------|------|------|
| Phase 1 | 5.5h | 低（纯增量，不改现有逻辑） |
| Phase 2 | 4.5h | 中（orchestrator 正则需覆盖足够多的中文模式） |
| Phase 3 | 5.5h | 低（tool 模式已有 cron-tools 参考） |
| Phase 4 | 3.5h | 低 |
| **合计** | **19h** | |

### 执行顺序依赖

```
Phase 1 (核心) ──► Phase 2 (入口) ──► Phase 4 (验证)
                 ──► Phase 3 (Agent) ──► Phase 4 (验证)

Phase 2 和 Phase 3 可并行
```
