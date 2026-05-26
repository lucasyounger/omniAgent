# PR Pool → 多 CodeAgent 执行能力补齐最终方案

## 目标

让 OmniAgent 在完成 PR Pool 中已确认需求/切片时，能稳定拉起真实 Coding 任务，并且可以明确指定使用哪一个 CodeAgent 执行器：

- `claude_code`：默认命令改为 `cc --dangerously-skip-permissions`
- `opencode`：使用 `opencode`
- `codex`：新增一等 executor，使用 `codex`
- `custom`：保留自定义命令兜底

方案借鉴 Multica 的核心执行设计，但不复制其 Go daemon/DB 全量架构：复用 OmniAgent 现有 `RuntimeTask → Task Dispatcher → CodeAgent → Team Runtime` 链路，在 PR Pool 层补齐执行契约、executor 选择、状态回收、重试上下文和文档测试。

实施完成后，将把该设计文档落到：

- `.omc/plans/pr-pool-codeagent-execution.md`

## 背景与现状

当前已有链路：

```text
PR Pool item ready
  → develop-pr-pool-item / pr_pool.develop RuntimeTask
  → src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts
  → ensureWorktree()
  → writeCodeAgentPrBrief()
  → taskRuntime.createTask(code.task)
  → dispatchRuntimeTask(codeTask.id)
  → src/mastra/runtime/task-dispatcher/handlers/code-handler.ts
  → startCodeTask()
  → src/mastra/lib/code-task-store.ts
  → spawn CLI process
```

当前缺口：

1. executor 只支持 `claude_code | opencode | custom`，没有 `codex` 一等支持。
2. `claude_code` 默认命令仍偏向 `claude`，用户要求实际命令为 `cc --dangerously-skip-permissions`。
3. PR Pool develop 虽已能创建 CodeTask，但 payload/context 不够结构化，失败重试上下文较弱。
4. PR Pool item、RuntimeTask、CodeTask 三套状态依赖 reconcile，需进一步稳定 completed/failed/waiting_user_confirm 回写。
5. 重复 develop 缺少明确防重策略。

## Multica 可借鉴但不全量迁移的点

借鉴：

- task context 结构化：类似 Multica `agent_task_queue.context JSONB`，在 CodeTask payload 中承载 PR item 执行上下文。
- task lifecycle：`queued/dispatched/running/completed/failed/cancelled` 的状态思路映射到 OmniAgent RuntimeTask + CodeTask + PRItem。
- prompt builder 分流：普通开发、重试修复、patch proposal/dryRun 分别构建 brief。
- retry context：保存 previous task、failure reason、retry count，注入下一次执行。
- workdir/brief 持久化：PR Pool worktree 和 CodeAgent brief 作为执行契约。

不迁移：

- 不新增 Multica 式常驻 daemon。
- 不引入数据库/SQL claim。
- 不重写 CodeAgent 子进程管理。
- 不实现 runtime heartbeat 或云 runtime。

## 推荐实现

### 1. Executor 模型扩展

修改：

- `src/mastra/lib/code-task-store.ts`
- `src/mastra/runtime/task-dispatcher/utils.ts`
- `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`
- `src/mastra/tools/code-tools.ts`
- `src/mastra/tools/pr-pool-tools.ts`

将 executor 类型从：

```ts
type CodeTaskExecutor = 'claude_code' | 'opencode' | 'custom';
```

扩展为：

```ts
type CodeTaskExecutor = 'claude_code' | 'opencode' | 'codex' | 'custom';
```

#### executor 命令解析规则

在 `code-task-store.ts` 中调整：

```ts
function resolveCodeTaskExecutor(executor, command) {
  if (executor) return executor;
  if (process.env.OMNI_CODE_AGENT_EXECUTOR === 'opencode') return 'opencode';
  if (process.env.OMNI_CODE_AGENT_EXECUTOR === 'codex') return 'codex';
  if (process.env.OMNI_CODE_AGENT_EXECUTOR === 'custom') return 'custom';
  return 'claude_code';
}
```

命令默认值：

```ts
function resolveExecutorCommand(executor) {
  if (executor === 'opencode') {
    return process.env.OMNI_OPENCODE_COMMAND || process.env.OMNI_CODE_AGENT_COMMAND || 'opencode';
  }
  if (executor === 'codex') {
    return process.env.OMNI_CODEX_COMMAND || process.env.OMNI_CODE_AGENT_COMMAND || 'codex';
  }
  if (executor === 'custom') {
    return process.env.OMNI_CODE_AGENT_COMMAND || process.env.OMNI_CLAUDE_COMMAND || 'cc';
  }
  return process.env.OMNI_CLAUDE_COMMAND || process.env.OMNI_CODE_AGENT_COMMAND || 'cc';
}
```

参数默认值：

- `claude_code`：默认 args 为 `['--dangerously-skip-permissions']`
- `opencode`：默认从 `OMNI_OPENCODE_ARGS` 或 `OMNI_CODE_AGENT_ARGS`，否则 `[]`
- `codex`：默认从 `OMNI_CODEX_ARGS` 或 `OMNI_CODE_AGENT_ARGS`，否则 `[]`
- `custom`：默认从 `OMNI_CODE_AGENT_ARGS`，否则 `[]`

prompt arg 默认值：

- `claude_code`：默认 `-p`
- `opencode`：默认 `OMNI_OPENCODE_PROMPT_ARG || OMNI_CODE_AGENT_PROMPT_ARG || '-p'`
- `codex`：默认 `OMNI_CODEX_PROMPT_ARG || OMNI_CODE_AGENT_PROMPT_ARG || '-p'`
- `custom`：默认 `OMNI_CODE_AGENT_PROMPT_ARG || '-p'`

注意：如果用户显式传入 `command/args/promptArg`，优先使用显式值。

### 2. PR Pool develop 支持指定 executor

当前 `develop-pr-pool-item` 已有 `executor` 参数，但只允许 `claude_code | opencode | custom`。

修改：

- `src/mastra/tools/pr-pool-tools.ts`
- `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`

将 schema 改为：

```ts
z.enum(['claude_code', 'opencode', 'codex', 'custom'])
```

`dispatchPrPoolDevelopTask()` 中 executor 解析：

```ts
const executor =
  codeTaskExecutorValue(payload.executor) ||
  codeTaskExecutorValue(process.env.OMNI_CODE_AGENT_EXECUTOR) ||
  'claude_code';
```

其中 `codeTaskExecutorValue()` 也接受 `codex`。

调用示例语义：

```text
develop-pr-pool-item({ prItemId, executor: 'claude_code' })
  → cc --dangerously-skip-permissions -p <prompt>

develop-pr-pool-item({ prItemId, executor: 'opencode' })
  → opencode -p <prompt>

develop-pr-pool-item({ prItemId, executor: 'codex' })
  → codex -p <prompt>
```

### 3. CodeTask payload 结构化，借鉴 Multica context

修改：

- `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`

抽取：

```ts
function buildCodeTaskPayload(item, parentTask, codeAgentBriefPath, payload) {
  return {
    workspacePath,
    objective,
    contextBrief,
    codeAgentBriefPath,
    dryRun,
    executionMode,
    command,
    args,
    promptArg,
    executor,
    prItemId: item.id,
    runtimeTaskId: parentTask.id,
    acceptanceCriteria: item.acceptanceCriteria,
    testCommand: item.testCommand,
    impact: item.impact,
    dependencies: item.dependencies,
    constraints: item.constraints,
    nonGoals: item.nonGoals,
    retryContext: buildRetryContext(item),
  };
}
```

这样 CodeAgent 不需要理解 PR Pool store，即可从 payload/contextBrief 获得完整执行上下文。

### 4. 防重复 develop

在 `dispatchPrPoolDevelopTask()` 中增加防重：

- 如果 item 是 `ready`：允许进入 `scheduled → developing`。
- 如果 item 是 `scheduled`：允许继续创建/恢复 CodeTask。
- 如果 item 是 `developing` 且已有 `run.codeTaskId`：不再创建新 CodeTask，返回已有 task 信息。
- 如果 item 是 `waiting_user_confirm`：不直接重新 develop，要求 approve/retry 后回 ready。
- 其他状态直接失败。

这对应 Multica 同 agent/issue 串行化思想，但使用现有 PR item 状态和 `run.codeTaskId` 实现。

### 5. 状态回收与失败重试

修改：

- `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
- `src/mastra/runtime/pr-pool/pr-pool-store.ts`

扩展 `PRItemRun`：

```ts
type PRItemRun = {
  runtimeTaskId?: string;
  codeTaskId?: string;
  previousCodeTaskId?: string;
  lastRunId?: string;
  codeAgentBriefPath?: string;
  retryCount: number;
  maxRetries: number;
  lastFailureReason?: string;
  lastDispatchedAt?: string;
  lastCompletedAt?: string;
};
```

`reconcileDevelopmentRuns()`：

- CodeTask `completed`：
  - PR item → `completed`
  - `run.lastRunId = codeTask.teamRunId`
  - `run.lastCompletedAt = now`
  - 清理 `blocking`
- CodeTask `failed/cancelled`：
  - PR item → `failed`
  - `blocking = { category: 'runtime_error', reason, detectedAt }`
  - `run.lastFailureReason = reason`
- CodeTask `queued` 且 item 非 waiting：
  - PR item → `waiting_user_confirm`

`retry(id)`：

- 只允许 `failed`。
- 检查 `retryCount < maxRetries`。
- 将 `run.codeTaskId` 移入 `run.previousCodeTaskId`。
- `retryCount += 1`。
- 状态回 `ready`。
- 保留 failure/blocking 信息，下一次 develop 注入 `retryContext`。

### 6. Brief / Prompt 更新

修改：

- `src/mastra/runtime/pr-pool/pr-pool-store.ts`
- `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`

`buildCodeAgentPrBriefMarkdown()` 增加：

```md
## Execution Backend

- Executor: claude_code | opencode | codex | custom
- Command: resolved at dispatch time

## Retry Context

- Retry Count: n/max
- Previous Code Task: ...
- Last Failure Reason: ...
```

`buildCodeAgentPrompt()` 增加明确启动要求：

- 先读 `CodeAgent PR Brief`
- 按 acceptance criteria 实现
- 跑 `testCommand` 或最小相关验证
- 输出 changed files / tests / risks / follow-ups
- 不要标记完成除非验证通过

### 7. 文档落地

实施后同步：

- `docs/agents/TASK_AGENT.md`
  - 说明 PR Pool develop 通过 RuntimeTask 调 CodeAgent。
  - 说明 executor 可选：`claude_code/opencode/codex/custom`。
- `docs/agents/CODE_AGENT.md`
  - 说明默认 ClaudeCode 命令为 `cc --dangerously-skip-permissions`。
  - 说明环境变量：
    - `OMNI_CODE_AGENT_EXECUTOR`
    - `OMNI_CLAUDE_COMMAND`
    - `OMNI_CODEX_COMMAND`
    - `OMNI_OPENCODE_COMMAND`
    - `OMNI_CODE_AGENT_ARGS`
    - `OMNI_CODEX_ARGS`
    - `OMNI_OPENCODE_ARGS`
    - `OMNI_*_PROMPT_ARG`
- `.omc/plans/pr-pool-codeagent-execution.md`
  - 保存本最终方案。

## 测试计划

### 必改/新增测试

- `tests/code-task-store.test.ts`
  - `claude_code` 默认 command 为 `cc`，args 包含 `--dangerously-skip-permissions`。
  - `opencode` 使用 opencode 默认命令。
  - `codex` 使用 codex 默认命令。
  - 显式 command/args/promptArg 优先级高于 executor 默认值。

- `tests/pr-pool-runtime.test.ts`
  - completed reconcile 回写 completed。
  - failed reconcile 写 blocking 和 lastFailureReason。
  - retry 写 previousCodeTaskId/retryCount，并保留 failure context。
  - 超过 maxRetries 抛错。

- `tests/pr-pool-dispatcher.test.ts`（新建或合并到现有 dispatcher 测试）
  - develop executor = `claude_code` 时传给 code.task。
  - develop executor = `opencode` 时传给 code.task。
  - develop executor = `codex` 时传给 code.task。
  - developing + run.codeTaskId 已存在时不重复创建 CodeTask。
  - retryContext 被注入 contextBrief/payload。

### 验证命令

```bash
npm run verify:change-sync
npm run typecheck
npm test -- tests/code-task-store.test.ts
npm test -- tests/pr-pool-runtime.test.ts
npm test -- tests/pr-pool-dispatcher.test.ts
```

如项目脚本不支持 `npm test -- <file>`，改用现有 Vitest 定向命令。

## GitNexus 要求

实施前对将编辑的符号运行 impact：

- `startCodeTask`
- `resolveCodeTaskExecutor`
- `resolveExecutorCommand`
- `dispatchPrPoolDevelopTask`
- `codeTaskExecutorValue`
- `reconcileDevelopmentRuns`
- `retry`
- `buildCodeAgentPrBriefMarkdown`

如 HIGH/CRITICAL，先报告 blast radius。

实施后提交前运行：

```ts
gitnexus_detect_changes({ scope: 'all' })
```

## 风险与控制

- `cc --dangerously-skip-permissions` 风险高：仅在 workspace allowlist 内执行，继续复用 `assertAllowedWorkspace`。
- executor 参数拼接风险：Windows 继续使用 prompt file + JSON payload + PowerShell argv，不走 shell 字符串拼接。
- `codex` CLI 参数可能与 `-p` 不一致：保留 `OMNI_CODEX_PROMPT_ARG` 可配置。
- direct 执行会改文件：PR Pool develop 默认仍可通过 `executionMode: patch_proposal` 或 env 控制。
- 状态不一致：reconcile 是最终一致性兜底。

## 不在本切片范围

- 不实现 Multica 常驻 daemon。
- 不实现 runtime heartbeat / capability discovery。
- 不实现 CodeAgent 子进程跨重启恢复。
- 不自动 commit/push。
- 不引入数据库/锁服务。
