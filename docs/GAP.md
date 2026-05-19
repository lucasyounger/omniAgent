# 一、目前还存在的主要偏差

## 偏差 1：Runtime 还是 facade，不是真正的 Runtime

现在 `taskRuntime` 本质上是对 `team-runtime-store` 的薄包装。它把 TeamTask 状态映射成 RuntimeTask 状态，但并没有真正实现独立状态机。比如类型里已经有：

```text
created
pending
running
waiting_user_confirm
succeeded
failed
cancelled
retrying
paused
```

但实际 TeamTask 只有：

```text
queued
running
completed
failed
cancelled
interrupted
timed_out
```

并且 `task-runtime.ts` 已经不再只是被动状态映射：它会校验 RuntimeTask 状态转换、写入独立 RuntimeTask store，并把 runtime 状态镜像到 TeamTask metadata 兼容层。

> 2026-05-19 verified slice: RuntimeTask / TeamTask 一致性审计已补强
> 回归测试。新增覆盖确认 RuntimeTask record、TeamTask metadata 和 runtime
> event log 在 running/succeeded 与 failed/retrying/retry-task 路径上保持一致。
> `transition` 影响面为 CRITICAL，因此本片只固化现状与审计契约，不改状态机行为。

这会导致一个问题：**设计文档里说有 TaskRuntime，但代码里还没有真正的任务生命周期控制。**

建议下一步把 TaskRuntime 做成真正核心：

```text
TaskRuntime
  - createTask
  - approveTask
  - rejectTask
  - startTask
  - completeTask
  - failTask
  - retryTask
  - cancelTask
  - pauseTask
  - resumeTask
```

并且所有状态转换必须经过状态机校验。

---

## 偏差 2：Tool Gateway 只审计，还没有真正“拦截”

现在 `ToolGatewayPolicy` 已经有：

```ts
risk
capability
requireApproval
audit
```

但 `executeWithToolGateway` 目前只是执行工具、记录审计、失败时记录错误；没有真正检查 `requireApproval`，也没有做 capability 权限校验、用户确认、沙箱策略或危险操作拦截。([GitHub][8])

所以现在的 Tool Gateway 更准确地说是：

```text
Tool Audit Wrapper
```

还不是：

```text
Tool Permission Gateway
```

更关键的是，部分 workflow 仍然绕过 Tool Gateway。例如 `code-task-workflow.ts` 直接调用 `startClaudeCodeTask(inputData)`，没有走 `executeWithToolGateway`。([GitHub][9])

这会造成安全边界不一致：

```text
Agent 调 tool：可能走 Gateway
Workflow 调 lib：绕过 Gateway
Gateway 命令：直接 startClaudeCodeTask
```

> 2026-05-19 verified slice: Gateway `/task <workspacePath> :: <objective>` no
> longer starts Claude Code directly. It now creates a `code.claude_code_task`
> RuntimeTask, dispatches through Task Dispatcher, and enters
> `waiting_user_confirm` until Tool Gateway approval is granted.

下一步要统一成：

```text
任何高危能力
  ↓
Tool Gateway
  ↓
approval / policy / audit / sandbox
  ↓
实际执行
```

---

## 偏差 3：OmniRouterAgent 仍然偏“超级 Agent”

`OmniRouterAgent` 现在直接挂了：

```text
teamTools
teamRuntimeTools
codeTools
cronTools
memoryTools
```

同时还注册了 codeAgent、cronAgent、knowledgeAgent 和多个 workflows。([GitHub][10])

这比之前更强，但也意味着 Router 还是拥有大量直接能力。你文档里也承认“direct tool use 是 Runtime / Tool Gateway 迁移中的兼容路径”。([GitHub][10])

这和我们之前定的原则还有偏差：

```text
Router 不应该拥有所有高危工具
Router 应该主要创建任务、查询任务、读取结果
具体业务工具由 specialist Agent 或 Runtime 处理
```

我建议 Router 最终只保留这些工具：

```text
createTask
getTask
listInbox
getRunResult
listTeamMembers
requestApproval
```

不要让 Router 直接持有 `startClaudeCodeTaskTool`、`createCronJobTool`、`upsertUserProfileFactTool` 这类具体业务工具。

---

## 偏差 4：SchedulerRuntime 还没有真正独立

现在 `schedulerRuntime` 只是把 `createCronJob`、`listCronJobs`、`runCronJobNow` 等函数暴露出来。([GitHub][11])

真正执行定时任务的逻辑还在 `cron-store.ts` 里，而且 `cron-store.ts` 直接 import 了 `startClaudeCodeTask`。更重要的是，`executeCronJob` 目前只支持 `codeAgent`，非 codeAgent 会直接报错。([GitHub][12])

这和我们之前讨论的目标还有偏差：

```text
SchedulerRuntime 只负责什么时候触发
TaskRuntime 负责创建任务
Orchestrator 负责路由
Business Agent 负责执行
```

现在实际是：

```text
CronStore 到点
  ↓
直接 startClaudeCodeTask
```

更合理的是：

```text
SchedulerRuntime 到点
  ↓
TaskRuntime.createTask({
  taskType: "research.ai_daily_digest",
  payload: {...}
})
  ↓
Orchestrator dispatch
  ↓
ResearchAgent / CodeAgent / KnowledgeAgent
```

---

## 偏差 5：KnowledgeAgent 仍然只是 docs memory，还不是 MemoryRuntime

现在 `memoryRuntime` 只是包装了：

```text
listDocs
readDoc
appendEpisode
proposeDocUpdate
updateIndex
upsertUserFact
```

这些底层又来自 `docs-memory.ts`。([GitHub][13])

它目前还缺少我们之前说的几个关键能力：

```text
全文检索
向量检索
混合检索
记忆来源
记忆隐私等级
记忆冲突检测
记忆过期
记忆删除
记忆应用审核
```

`MEMORY_INDEX.json` 现在更像文件清单和元数据索引，不是可检索知识系统。`docs-memory.ts` 里 `updateMemoryIndex` 主要记录 path、title、purpose、bytes、updatedAt。([GitHub][14])

所以现在的 KnowledgeAgent 是好的第一步，但还不是完整知识系统。

---

## 偏差 6：CodeAgent 还不够安全

现在 CodeAgent 已经限制 workspace 必须在 `OMNI_ALLOWED_WORKSPACES` 下，这很好。`paths.ts` 里默认允许根是 `L:\Code`，并用 `assertAllowedWorkspace` 判断路径是否在允许目录内。([GitHub][15])

但本地助手做代码执行还需要更多安全措施：

```text
默认只读分析
先生成 patch
用户确认 diff
沙箱中应用 patch
执行测试
失败自动回滚
危险命令拦截
网络访问控制
文件写入范围控制
```

当前 `startClaudeCodeTask` 还是直接 spawn Claude Code CLI，并在目标 workspace 下执行。

这对原型可以，但如果你要让它长期作为本地助手运行，必须增加安全层。

---

## 偏差 7：root README 还是旧版定位

根目录 README 仍然描述为：

```text
local Mastra Agent Team
router agent
Claude Code execution agent
cron management agent
knowledge agent
```

并且 First version scope 还是 Router、CodeAgent、CronAgent、KnowledgeAgent。([GitHub][16])

但 `docs/ARCHITECTURE.md` 已经升级到了 Runtime facade、Team Runtime、Gateway、Tool Gateway 这种架构。([GitHub][3])

所以现在文档有点割裂：

```text
README：还是 v0.1 多 Agent 原型
docs/ARCHITECTURE：已经是 v0.2 Runtime 架构
代码：介于两者之间
```

建议把 README 改成当前新架构入口，否则别人看仓库会低估设计层级。

---

# 二、我建议下一版重点增强什么

## P0：先把 Tool Gateway 做实

这是最优先的。

当前 Tool Gateway 已经有审计，但没有真正权限拦截。建议加：

```ts
interface ToolExecutionContext {
  actorId: string
  sessionId?: string
  channel?: string
  approvalToken?: string
  requestId: string
}

interface ToolPolicy {
  toolId: string
  risk: "safe" | "medium" | "dangerous"
  capability: string
  requireApproval: boolean
  sandboxRequired: boolean
  allowedPaths?: string[]
  deniedCommands?: string[]
}
```

执行逻辑应该变成：

```text
executeWithToolGateway
  ↓
校验 capability
  ↓
判断 risk
  ↓
如果 requireApproval 且没有 approvalToken
    → 创建 approval request
    → Task 状态改为 waiting_user_confirm
    → 不执行
  ↓
校验路径 / 参数 / 命令
  ↓
必要时进入 sandbox
  ↓
执行
  ↓
写审计日志
```

这一步做好后，本地助手才敢接入更多能力。

---

## P0：把 SchedulerRuntime 从 CronStore 中解耦

现在 CronStore 直接启动 CodeAgent 任务，这是最大架构耦合点。([GitHub][12])

建议把 `CronJob` 改成：

```ts
interface Schedule {
  id: string
  name: string
  cron?: string
  runAt?: string
  timezone: string
  taskType: string
  targetAgentId?: string
  payload: Record<string, unknown>
  enabled: boolean
  misfirePolicy: "skip" | "run_once" | "run_all"
  maxConcurrentRuns: number
}
```

到点后只做一件事：

```ts
TaskRuntime.createTask({
  sourceAgentId: "scheduler-runtime",
  targetAgentId,
  type: taskType,
  payload
})
```

不要在 SchedulerRuntime 里直接 import CodeAgent 或 `startClaudeCodeTask`。

---

## P0：TaskRuntime 改成真正状态机

现在 TaskRuntime 只是状态映射。([GitHub][17])

建议增加状态转换表：

```ts
const transitions = {
  created: ["waiting_user_confirm", "pending", "cancelled"],
  waiting_user_confirm: ["pending", "cancelled"],
  pending: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "paused"],
  paused: ["running", "cancelled"],
  failed: ["retrying"],
  retrying: ["pending"],
}
```

然后所有任务状态更新都必须走：

```ts
TaskRuntime.transition(taskId, nextStatus, reason)
```

不要让各个 store 自己随便改状态。

---

## P0：所有 workflow 也必须走 Tool Gateway

现在 `code-task-workflow.ts` 直接调用 `startClaudeCodeTask`。([GitHub][9])

建议改成：

```text
Workflow
  ↓
TaskRuntime
  ↓
Tool Gateway
  ↓
Code execution
```

否则工具调用路径会出现两套安全规则。

---

## P1：把 Router 瘦身

当前 Router 还是挂了太多工具。([GitHub][10])

建议分阶段收敛：

### 当前

```text
Router
  - codeTools
  - cronTools
  - memoryTools
  - teamRuntimeTools
  - teamTools
```

### 下一版

```text
Router
  - taskRuntimeTools
  - inboxTools
  - resultTools
  - teamDiscoveryTools
```

### 最终

```text
Router 只做：
  - 意图识别
  - 任务创建
  - 任务查询
  - 结果汇总
```

具体能力让 specialist agent 处理。

---

## P1：Knowledge 系统增加 Retriever

现在 MemoryRuntime 只是 docs 操作。([GitHub][13])

建议新增：

```text
src/mastra/runtime/memory/
  docs-store.ts
  fulltext-index.ts
  vector-index.ts
  retriever.ts
  memory-policy.ts
  memory-conflict-detector.ts
```

最少先做全文检索：

```text
ripgrep / minisearch
```

然后再加向量检索：

```text
LanceDB / Chroma / Qdrant
```

记忆对象建议结构化：

```ts
interface MemoryRecord {
  id: string
  type: "profile" | "project" | "decision" | "procedure" | "episode"
  content: string
  source: string
  confidence: number
  privacy: "public" | "private" | "sensitive"
  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

---

## P1：CodeAgent 改成 patch-first

当前 CodeAgent 直接让 Claude Code 在 workspace 下执行。

更安全的流程应该是：

```text
1. 只读分析代码
2. 生成修改计划
3. 生成 patch
4. 用户确认 patch
5. 在 sandbox/worktree 中应用 patch
6. 执行测试
7. 成功后合并
8. 失败则回滚
```

本地助手尤其要避免：

```text
AI 直接改业务仓库
AI 直接删文件
AI 执行未知 shell
AI 自动提交 Git
```

---

## P1：Gateway 增加可靠投递和安全策略

现在 Gateway 已经有 delivery worker，但 delivery 失败只是 console error，没有明确重试状态和失败记录。([GitHub][18])

建议增加：

```text
delivery retry
幂等 delivery key
失败次数
dead letter queue
消息签名
rate limit
per sender 权限
channel session 过期
管理员命令
```

否则 QQ Bot 接进来以后，长时间运行会遇到消息重复、丢失、权限混乱问题。

---

## P2：新增 ResearchAgent

你之前的目标里有：

```text
定期探索 AI 热点论文
GitHub AI 项目 star 上升榜
总结后通过 QQ Bot 推送
```

当前仓库还没有真正 ResearchAgent。现在 Cron 只支持 codeAgent target jobs。([GitHub][12])

建议新增：

```text
ResearchAgent
  - arXiv adapter
  - GitHub trending adapter
  - Papers with Code adapter
  - Hacker News adapter
  - 去重
  - 热度评分
  - 摘要生成
  - 生成日报
  - 写入 MemoryRuntime
  - 调 Notify/Gateway 推送
```

并定义任务类型：

```text
research.ai_daily_digest
research.github_trending_summary
research.paper_watch
research.repo_watch
```

---

# 三、建议的下一版目录结构

你现在目录已经比之前清楚，但我建议下一版继续拆：

```text
src/
  mastra/
    agents/
      router/
      code/
      schedule/
      knowledge/
      research/
      notify/

    runtime/
      task-runtime/
        index.ts
        task-store.ts
        state-machine.ts
        retry-policy.ts
        approval.ts

      scheduler-runtime/
        index.ts
        schedule-store.ts
        runner.ts
        misfire-policy.ts

      memory-runtime/
        index.ts
        docs-store.ts
        fulltext-retriever.ts
        vector-retriever.ts
        memory-policy.ts

      tool-gateway/
        index.ts
        policy.ts
        approval.ts
        audit.ts
        sandbox.ts

      event-bus/
        index.ts

    tools/
      code/
      schedule/
      memory/
      notify/
      research/

  gateway/
    channels/
      onebot/
      qqbot/
      http/
    delivery/
    auth/
    sessions/
```

重点是把现在的 `runtime/*.ts` 从 facade 文件拆成真正模块。

---

# 四、下一步最值得改的 10 个点

按优先级排序：

1. **Tool Gateway 增加真实审批拦截**，不是只 audit。
2. **TaskRuntime 增加状态机**，支持 `waiting_user_confirm`、`retrying`、`paused`。
3. **SchedulerRuntime 不再直接调用 `startClaudeCodeTask`**。
4. **CronJob 改成 `taskType + payload` 模型**。
5. **Router 移除 code/cron/memory 直接工具，只保留 runtime 工具**。
6. **CodeAgent 改成 patch-first + sandbox-first**。
7. **MemoryRuntime 增加全文检索和结构化 MemoryRecord**。
8. **Gateway delivery 增加重试、幂等和 dead letter**。
9. **README 更新为当前 Runtime 架构**。
10. **新增 ResearchAgent，跑通 AI 日报到 QQ Bot 的完整闭环**。

---

# 五、最终评价

这版整改没有走偏，方向是对的。

但现在处在一个过渡阶段：

```text
命名上：已经是 Runtime / Gateway / Team Runtime 架构
实现上：还是 file store + facade + direct tool compatibility
```

所以我建议你下一步不要急着继续加更多 Agent，而是先把底座做实：

```text
TaskRuntime 状态机
ToolGateway 权限拦截
SchedulerRuntime 解耦
MemoryRuntime 检索能力
CodeAgent 安全执行
```

这五个打牢之后，再加 ResearchAgent、NotifyAgent、DeviceAgent、QQ Bot、Open WebUI、MCP，系统会稳很多。

[1]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/index.ts "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/lib/team-runtime-store.ts "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/docs/ARCHITECTURE.md "raw.githubusercontent.com"
[4]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/tool-gateway.ts "raw.githubusercontent.com"
[5]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/lib/code-task-store.ts "raw.githubusercontent.com"
[6]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/gateway/http-server.ts "raw.githubusercontent.com"
[7]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/docs/TESTING.md "raw.githubusercontent.com"
[8]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/types.ts "raw.githubusercontent.com"
[9]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/workflows/code-task-workflow.ts "raw.githubusercontent.com"
[10]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/agents/omni-router-agent.ts "raw.githubusercontent.com"
[11]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/scheduler-runtime.ts "raw.githubusercontent.com"
[12]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/lib/cron-store.ts "raw.githubusercontent.com"
[13]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/memory-runtime.ts "raw.githubusercontent.com"
[14]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/lib/docs-memory.ts "raw.githubusercontent.com"
[15]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/lib/paths.ts "raw.githubusercontent.com"
[16]: https://github.com/lucasyounger/omniAgent/blob/master/README.md "omniAgent/README.md at master · lucasyounger/omniAgent · GitHub"
[17]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/mastra/runtime/task-runtime.ts "raw.githubusercontent.com"
[18]: https://raw.githubusercontent.com/lucasyounger/omniAgent/refs/heads/master/src/gateway/delivery.ts "raw.githubusercontent.com"
