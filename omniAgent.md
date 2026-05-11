# OmniAgent 设计文档

> OmniAgent 代码仓深度分析：基于 Mastra 的多智能体编排平台，以复合式工程和上下文工程为核心设计理念。

---

## 1. 概述

OmniAgent 是一个本地 Mastra 智能体团队（Agent Team），通过持久化协调协议将四个专业智能体编排在一起。它作为 Mastra 服务运行，以 LibSQL 支持的对话记忆和文件支持的 docs 系统作为规范长期记忆。

**技术栈：** TypeScript, Mastra `1.32.1`, LibSQL, Vitest, Zod `4.x`
**模型供应商：** DeepSeek（通过 Mastra AI SDK）
**入口：** `src/mastra/index.ts` → `npm run dev`（Mastra Studio 默认运行在 `localhost:4111`）

---

## 2. 架构：复合式工程

### 2.1 多智能体拓扑

OmniAgent 采用**轮辐式（hub-and-spoke）**智能体架构，OmniRouterAgent 为中心协调器，但任意智能体均可通过 Team Runtime 协议发起工作任务。

```
                    ┌──────────────────────┐
                    │   OmniRouterAgent    │
                    │    (用户面中心)       │
                    └──────┬───────────────┘
                           │ 通过 Team Runtime 委派
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────────┐
   │CodeAgent │    │CronAgent │    │KnowledgeAgent│
   │(ClaudeCLI)│   │(调度器)   │    │(文档记忆)     │
   └──────────┘    └──────────┘    └──────────────┘
```

### 2.2 智能体角色

| 智能体 | 状态 | 职责 | 关键工具 |
|---|---|---|---|
| **OmniRouterAgent** | 活跃 Mastra Agent | 意图路由、委派、最终回复合成 | 全部 team/runtime/code/cron/memory 工具 |
| **CodeAgent** | 活跃 Mastra Agent | Claude Code CLI 任务执行、进度汇报 | `start-claude-code-task` |
| **CronAgent** | 活跃 Mastra Agent | 定时任务生命周期、进程内调度器 | 定时任务的增删改查与手动触发 |
| **KnowledgeAgent** | 活跃 Mastra Agent | 文档支持的记忆维护、索引刷新 | 列出/读取文档、追加情景日志、写入提案 |
| **TaskAgent** | 协议角色（非类） | Team Runtime 协议所有权 | 14 个运行时工具 |

### 2.3 Team Runtime 协议 —— 通用协调层

Team Runtime 是 OmniAgent 中**最关键的架构决策**。它是一个协议，不绑定任何单一智能体。所有智能体都通过它完成委派工作。

```
源智能体 ──► Team Task ──► Team Run ──► Team Events（进度记录）
                   │              │
                   │              ▼
                   │         Team Result（持久化输出）
                   │              │
                   ▼              ▼
            Inbox 通知 ←──────────┘
                   │
                   ▼
            OmniRouterAgent 通过 resultRef 读取结果
```

**核心记录（文件存储，后续迁移至 LibSQL）：**

| 记录 | 存储位置 | 用途 |
|---|---|---|
| **Task** | `docs/runs/team/tasks.json` | 持久化工作请求（源智能体 → 目标智能体） |
| **Run** | `docs/runs/team/runs.json` | 单次执行尝试，含尝试计数器 |
| **Event** | `docs/runs/team/events.jsonl` | 追加式进度/状态变更日志 |
| **Inbox** | `docs/runs/team/inbox/{agentId}.jsonl` | 跨智能体通知（非真相来源） |
| **Result** | `docs/runs/team/results/{runId}.json` | 持久化执行输出 |

**任务状态状态机：**
```
queued → running → completed / failed / cancelled / interrupted / timed_out
                       │
                       ▼ （重试）
                  新的 queued 任务（带 retryOfTaskId）
```

**可靠性保证：**
- 启动恢复：处于 `running` 状态的运行 → 标记为 `interrupted`
- 超时扫描：定期轮询将过期的运行标记为 `timed_out`（默认 30 秒间隔）
- 重试：创建新任务并通过 `retryOfTaskId` 链接，保留完整历史
- 取消：取消运行中的 run 或直接取消排队中的 task
- 通知：完成/失败/中断/超时始终向源智能体和 `omni-router-agent` 发送收件箱消息

**持久化后端迁移边界：**
```typescript
// src/mastra/lib/team-runtime-store.ts:88
export const teamRuntimeStoreBackend: TeamRuntimeStoreBackend = {
  kind: 'file',   // ← 迁移点，将来切换为 kind: 'libsql'
  root: teamRunsRoot,
};
```

### 2.4 服务启动流程

```
1. dotenv/config 加载 .env
2. 创建 Mastra 实例，含 4 个 Agent + 2 个 Workflow + LibSQLStore
3. recoverInterruptedTeamRuns() — 标记孤立运行
4. markTimedOutTeamRuns() — 标记超时运行
5. startCronScheduler() — 进程内定时轮询循环
6. 定期超时扫描（setInterval, unref'd）
```

### 2.5 工作流层

注册了两个 Mastra 工作流，用于未来的步骤化执行：
- `runCodeTaskWorkflow` — 多步代码任务执行
- `memoryMaintenanceWorkflow` — 定期记忆提取与索引刷新

---

## 3. 文档系统：规范长期记忆

### 3.1 设计原则

> `docs/` 是规范长期记忆。Mastra Memory (LibSQL) 是运行时对话连续性。两者服务于不同的目的和时间跨度。

**为什么选择文件支持的文档记忆：**
- 可在 git 中审查和版本控制
- 可纠正（不同于不透明的聊天历史向量）
- 通过结构化卡片以低 token 成本供 AI 阅读
- 不受数据库重置和模型变更的影响

### 3.2 目录结构与语义

```
docs/
├── START_HERE.md              ← 最小可行上下文入口
├── CONTEXT_INDEX.json         ← 机器可读的导航中心
├── ARCHITECTURE.md            ← 紧凑架构概览
├── CONTEXT_PACKS.md           ← 面向任务的文档包定义
├── TESTING.md                 ← 测试契约与命令
│
├── agents/                    ← 智能体卡片（刻意简短，每张约 1KB）
│   ├── README.md              ← 如何使用智能体卡片
│   ├── AGENT_INDEX.json       ← 机器可读智能体目录
│   ├── OMNI_ROUTER_AGENT.md
│   ├── CODE_AGENT.md
│   ├── CRON_AGENT.md
│   ├── KNOWLEDGE_AGENT.md
│   └── TASK_AGENT.md          ← 协议角色卡片（非类）
│
├── knowledge/                 ← 持久化实现知识
│   ├── TEAM_RUNTIME.md        ← 协议规范，含迁移路径
│   ├── CLAUDE_CODE.md         ← Claude Code 集成细节
│   ├── CRON.md                ← 定时管理与调度解析
│   ├── PITFALLS.md            ← 已知问题的紧凑索引
│   ├── MASTRA.md
│   ├── CODEBASES.md
│   ├── PROJECTS.md
│   ├── TOOLS.md
│   └── TROUBLESHOOTING.md
│
├── memory/                    ← 规范长期记忆
│   ├── OMNI.md                ← 核心记忆：团队、运行规则
│   ├── CURRENT_CONTEXT.md     ← 当前目标与待办事项
│   ├── DECISIONS.md           ← 架构决策记录
│   ├── EPISODIC_LOG.md        ← 追加式低风险摘要
│   ├── PREFERENCES.md         ← 执行偏好
│   ├── USER.md                ← 用户画像记忆
│   ├── WORKSPACE.md           ← 工作区配置记忆
│   ├── MEMORY_INDEX.json      ← 自动生成的文件索引（由 KnowledgeAgent 维护）
│   └── doc-update-proposals.jsonl ← 可审查的变更提案
│
├── context/                   ← 每个智能体的提示上下文与预算规则
│   ├── context-budget.md      ← 全局上下文预算规则
│   ├── router-context.md      ← 路由意图分类
│   ├── code-agent-context.md
│   ├── cron-agent-context.md
│   └── knowledge-agent-context.md
│
├── skills/                    ← 可复用操作手册
│   ├── code-task.md
│   ├── cron-task.md
│   ├── doc-sync.md            ← 变更后文档更新流程
│   ├── memory-maintenance.md  ← 记忆提取与分类
│   └── repo-analysis.md
│
├── schemas/                   ← 数据契约（JSON Schema）
│   ├── team-task.schema.json
│   ├── team-run.schema.json
│   ├── team-event.schema.json
│   ├── team-result.schema.json
│   ├── inbox-message.schema.json
│   ├── cron-job.schema.json
│   ├── memory-card.schema.json
│   ├── task-result.schema.json
│   └── doc-update.schema.json
│
└── runs/                      ← 运行时产物（默认不加载）
    ├── code-runs/             ← Claude Code stdout/stderr 日志
    ├── cron-runs/             ← 定时任务存储 (jobs.json)
    ├── memory-runs/
    └── team/                  ← Team Runtime 持久化记录
        ├── tasks.json
        ├── runs.json
        ├── events.jsonl
        ├── inbox/
        └── results/
```

### 3.3 文档更新风险模型

KnowledgeAgent 将更新分为三个风险等级：

| 风险 | 处理方式 | 存储位置 |
|---|---|---|
| **低** | 直接追加到情景日志 | `memory/EPISODIC_LOG.md` |
| **中** | 创建文档更新提案供审查 | `memory/doc-update-proposals.jsonl` |
| **高** | 创建文档更新提案供审查 | `memory/doc-update-proposals.jsonl` |

这创建了一条审计跟踪 —— 没有可审查的提案，就不能自动覆盖稳定记忆。

### 3.4 索引策略

**MEMORY_INDEX.json** 由 `updateMemoryIndex()` 自动生成。它：
- 扫描除 `runs/**` 和自引用索引文件外的所有文档文件
- 从第一个 `# 标题` 提取标题
- 按目录分类用途（`agents/` → "智能体卡片"，`knowledge/` → "持久化实现知识"，等）
- 记录文件大小和修改时间
- 作为自动化上下文组装的机器可读目录

**AGENT_INDEX.json** 是手动维护的机器可读索引，将智能体映射到卡片、源文件、上下文包和关键词。

### 3.5 文档同步契约

```
代码变更 → 更新智能体卡片 → 更新知识文档 → 更新/添加测试 → 刷新 MEMORY_INDEX.json
```

这由 `doc-sync` 技能和 TESTING.md 契约强制执行。三种产物（代码、文档、测试）必须保持同步。

---

## 4. 上下文工程

### 4.1 核心理念

OmniAgent 被设计为**供未来的 AI 智能体修改**。文档系统中的每一个设计决策都为此用例优化：AI 智能体应能够加载所需的最小上下文，理解系统，进行更改，并更新文档 —— 全程无需扫描整个代码库。

### 4.2 上下文预算系统

上下文预算系统定义了**每个智能体加载多少上下文**以及**以什么顺序加载**：

**全局规则（`context/context-budget.md`）：**
1. 首先阅读 `START_HERE.md`
2. 从 `CONTEXT_PACKS.md` 中选择一个包
3. 在阅读任何源文件之前先阅读一张智能体卡片
4. 除非有特定 ID 指向，否则永远不读 `docs/runs/**`
5. 优先查阅 `knowledge/PITFALLS.md`，而非重新发现已知问题

**每个智能体的预算：**

| 智能体 | 预算规则 |
|---|---|
| Router | 路由不明确时加载团队注册表，最多 5 条记忆事实，不注入原始代码日志 |
| CodeAgent | 仅含目标 + 工作区路径 + 约束条件 + 简明上下文摘要 |
| KnowledgeAgent | 提案前阅读目标文档，保持提案简短且可审计 |

### 4.3 上下文包 —— 面向任务的文档捆绑

上下文包是核心的上下文组装机制。每个包精确捆绑特定任务类型所需的文档：

```
路由与委派 (Routing And Delegation):
  agents/OMNI_ROUTER_AGENT.md → agents/TASK_AGENT.md → knowledge/TEAM_RUNTIME.md

任务运行时 (TaskAgent / Team Runtime):
  agents/TASK_AGENT.md → knowledge/TEAM_RUNTIME.md → knowledge/PITFALLS.md
  → schemas/team-*.schema.json（仅在修改数据形状时需要）

代码执行 (CodeAgent / Claude Code):
  agents/CODE_AGENT.md → knowledge/CLAUDE_CODE.md → agents/TASK_AGENT.md

定时调度 (CronAgent / Scheduler):
  agents/CRON_AGENT.md → knowledge/CRON.md → agents/TASK_AGENT.md

文档记忆 (Docs Memory):
  agents/KNOWLEDGE_AGENT.md → skills/doc-sync.md → skills/memory-maintenance.md
```

### 4.4 智能体卡片 —— 紧凑上下文设计

每张智能体卡片**刻意保持简短**（约 1-1.5KB），并遵循严格的模板：
- 状态（活跃 / 协议角色）
- 源文件（带目录前缀）
- 关键行为 / 工具
- 已知陷阱
- 变更检查清单
- 相关文档

"阅读卡片后再扫描源文件"的约束通过文档约定而非代码强制执行。这是一个**嵌入在文档结构中的社会契约**。

### 4.5 阅读顺序优化

**START_HERE.md** 定义了严格的阅读顺序，旨在在达到可操作的理解之前最小化 token 消耗：

```
1. docs/memory/OMNI.md          （核心身份，约 750 字节）
2. docs/agents/README.md        （如何使用卡片，约 960 字节）
3. docs/ARCHITECTURE.md         （仅在修改运行时行为时需要，约 1.6KB）
4. 一张相关智能体卡片            （约 1-1.5KB）
5. 一个上下文包                  （2-3 个关联文档）
6. 仅在此之后：关联源文件
```

**排除规则**防止加载：
- `docs/runs/**` — 运行时日志，非设计知识
- `MEMORY_INDEX.json` — 机器索引，非叙事性上下文
- 全源码树扫描 — 使用智能体卡片作为入口

### 4.6 多层索引系统

三个机器可读索引服务于不同的上下文组装需求：

| 索引 | 格式 | 用途 | 更新者 |
|---|---|---|---|
| `CONTEXT_INDEX.json` | 手动编写 | 导航中心、默认阅读顺序、包定义 | 开发者 |
| `AGENT_INDEX.json` | 手动编写 | 智能体到源文件的映射，含关键词 | 开发者 |
| `MEMORY_INDEX.json` | 自动生成 | 完整文档文件目录，含元数据 | KnowledgeAgent |

### 4.7 上下文工程模式

**模式一：渐进式披露**
智能体卡片是第一层。知识文档是第二层。源文件是最后的手段。每一层仅在前一层不够用时才增加细节。

**模式二：反向规范**
文档明确声明什么**不要**读（`runs/**`、`MEMORY_INDEX.json`）—— 与明确什么要读同等重要。这对默认扫描一切的 AI 消费者至关重要。

**模式三：任务关联捆绑**
上下文包与具体的工程任务关联，而非与系统组件关联。"我需要修改路由"直接映射到一个包，而非一个组件图。

**模式四：陷阱即一等知识**
`knowledge/PITFALLS.md` 是已遇到问题的紧凑索引。在开始调试之前先查阅它，防止 AI 智能体重新发现已知问题。

---

## 5. 数据流分析

### 5.1 代码任务执行（完整流程）

```
1. 用户/OrmiRouterAgent 调用 start-claude-code-task(workspacePath, objective)
2. CodeAgent 验证 workspace ∈ OMNI_ALLOWED_WORKSPACES
3. 创建 Team Task {source: "omni-router-agent", target: "code-agent"}
4. 启动 Team Run {attempt: N}
5. 追加 Team Event: "team.run.started"
6. 将提示写入 docs/runs/code-runs/ 中的临时文件
7. 启动进程: powershell.exe → claude -p "$(cat tempfile)"
8. 捕获 stdout/stderr → docs/runs/code-runs/{taskId}.jsonl
9. 追加 Team Events 记录进度
10. 完成时:
    - 写入 Team Result → docs/runs/team/results/{runId}.json
    - 更新 Task/Run 状态 → "completed"
    - 发送收件箱通知 → omni-router-agent + 源智能体
11. OmniRouterAgent 读取收件箱 → getRunResult(resultRef) → 呈现给用户
```

### 5.2 定时任务执行流程

```
1. Mastra 启动 → startCronScheduler()
2. 进程内 setInterval 每 OMNI_CRON_POLL_INTERVAL_MS (30s) 扫描 jobs.json
3. 对每个调度匹配当前时间的活跃任务:
   a. 通过相同的 Team Runtime 路径创建 CodeAgent 任务
   b. 在定时任务记录中记录 lastRunTeamTaskId, lastRunTeamRunId
   c. 一次性任务: 启动后将状态设为 "paused"
4. 结果通过标准 Team Runtime 收件箱通知送达
```

### 5.3 存储边界

| 数据类型 | 存储位置 | 生命周期 | 访问模式 |
|---|---|---|---|
| 智能体指令 | Agent 构造函数内联 | 代码部署 | 智能体初始化时读取 |
| 对话记忆 | LibSQL（通过 Mastra Memory） | 运行时会话 | 每轮读写 |
| 智能体卡片 | `docs/agents/*.md` | Git 版本控制 | 上下文组装时读取 |
| 知识文档 | `docs/knowledge/*.md` | Git 版本控制 | 实现时读取 |
| 长期记忆 | `docs/memory/*.md` | Git 版本控制 | 通过 KnowledgeAgent 读写 |
| Team Runtime 记录 | `docs/runs/team/*` | 持久化（文件） | 执行时写入，状态查询时读取 |
| 代码任务日志 | `docs/runs/code-runs/*` | 短暂 | 执行时写入，调试时读取 |
| 定时任务存储 | `docs/runs/cron-runs/jobs.json` | 持久化（文件） | 调度操作时读写 |
| 数据模式 | `docs/schemas/*.json` | Git 版本控制 | 数据形状变更时读取 |

---

## 6. 安全设计

### 6.1 工作区隔离
- `OMNI_ALLOWED_WORKSPACES` 环境变量定义允许的路径（默认：`L:\Code`）
- `assertAllowedWorkspace()` 在执行前验证所有代码任务路径
- 通过 `normalizeInside()` 进行严格的路径前缀检查，防止路径遍历

### 6.2 密钥管理
- `.env` 通过 `.gitignore` 排除在 git 之外
- 文档系统明确禁止存储密钥、凭据或 API 密钥
- 记忆更新工具被指示过滤敏感数据
- 收件箱消息、事件和结果不得包含密钥

### 6.3 平台特定处理
- Windows：通过 PowerShell 调用 Claude Code（避免 `cmd.exe` 参数截断）
- 临时文件传递提示（避免 shell 转义问题）
- 通过 `findProjectRoot()` 向上查找到 `package.json` 来防止 `process.cwd()` 漂移

---

## 7. 扩展点

1. **LibSQL 迁移：** `teamRuntimeStoreBackend.kind` 从 `'file'` 切换到 `'libsql'` —— 协议行为不变
2. **新智能体：** 注册 Mastra Agent，添加智能体卡片，实现 Team Runtime 协议，添加到团队注册表
3. **新工作流：** 添加到 `src/mastra/workflows/`，在 `src/mastra/index.ts` 中注册
4. **调度类型：** 定时任务存储设计支持在现有解析基础上扩展 `once`/`daily`/`weekly`/`cron`
5. **向量索引：** `docs/` 结构已为未来基于嵌入的搜索做好准备（CURRENT_CONTEXT.md 将其列为待办事项）

---

## 8. 关键设计决策

| 决策 | 理由 |
|---|---|
| docs 作为规范记忆，而非数据库 | 可审查、可版本控制、可被人和 AI 纠正 |
| 先文件存储再迁移 Team Runtime | 在存储迁移之前确保协议稳定 |
| 智能体卡片每张 < 2KB | 最小化 AI 消费者的上下文 token 消耗 |
| Inbox 用于通知，Result 用于数据 | 关注点分离；收件箱是指针，结果是载荷 |
| Cron 仅为任务来源 | 所有智能体使用统一的结果协议；避免碎片化 |
| 上下文包而非组件文档 | 面向任务的组装匹配 AI 智能体的实际工作方式 |
| 陷阱作为一等知识 | 防止 AI 智能体重新发现已知问题 |

---

## 9. GitNexus 知识图谱

> 注意：OmniAgent 仓库在分析时尚未被 GitNexus 索引。其 Mastra 依赖（`L:\Code\Mastra`，34,776 节点，107,385 边）已索引。OmniAgent 被索引后，知识图谱将展示 OmniAgent 的智能体实现与 Mastra 框架的 `@mastra/core` Agent、Tool 和 Workflow 基元之间的跨仓库关系。

---

*2026-05-11 基于完整代码仓分析生成。*
