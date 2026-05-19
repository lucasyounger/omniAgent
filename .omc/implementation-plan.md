# OmniAgent 总体落地计划

> 状态：待确认  
> 生成时间：2026-05-19  
> 执行原则：安全闭环优先、PR 级小步快跑、每步端到端验证、代码/测试/文档/过程记录同步、可中断恢复。

## 1. 背景与目标

OmniAgent 的最终目标是：基于 Mastra 框架，构建一个本地端侧 Agent Team / 个人助手，把 AI 应用工程师的端侧作业流完整串起来，成为一个能长期执行任务、越用越懂你、能沉淀知识、持续自我进化的本地智能工作助手。

现有 `.omc/gap.md` 的长期方向整体合理，但当前代码仓已经完成了部分原 gap 中提到的能力，例如：

- `TaskRuntime` 生命周期和状态机已经存在。
- `Task Dispatcher` 已经能分发多类 RuntimeTask。
- `Tool Gateway` 已经具备审批拦截能力，不只是 audit wrapper。
- `schedule.run_now` 已经能对直接代码执行动态触发审批。
- `OmniRouterAgent` 已经比旧 gap 描述更收敛。
- Gateway `/task` 直接启动 Claude Code 的绕过路径已在第一片中关闭。

因此后续不应照搬旧 gap 一次性重建，而应基于当前仓库状态持续推进。

## 2. 总体路线

```text
M0：安全边界闭环
→ M1：最小记忆与上下文骨架
→ M2：需求 E2E MVP 产物链路
→ M3：长任务与工作编排增强
→ M4：记忆系统增强与知识自更新
→ M5：内部系统 / MCP / A2A / 手机端接入
→ M6：产品化、评估与持续演进
```

当前优先级：**安全闭环优先**。

原因：OmniAgent 最终会执行本地代码、读取记忆、连接外部系统和长期运行任务。如果安全边界、审批、审计和任务状态先不统一，后续记忆/E2E/长任务能力越强，风险越高。

## 3. 执行协议

每个 PR 级切片必须满足：

1. 修改前先做影响分析。
   - 修改函数/类/方法前运行 `gitnexus_impact`。
   - HIGH / CRITICAL 风险必须先停下说明，不直接改。
2. 每步只解决一个明确问题。
3. 同步更新：
   - 代码
   - 测试
   - 文档
   - 本计划的执行记录
4. 每步必须端到端验证。
5. 验证失败先修复，不跳过。
6. 不做 speculative abstraction。
7. 不直接污染长期记忆，长期记忆更新通过 proposal 或人工确认。
8. 中断后从本文件的“执行状态”继续。

## 4. 阶段计划

---

# M0：安全边界闭环

## 目标

把所有高风险能力统一收敛到：

```text
入口 / Workflow / Scheduler / Gateway
→ RuntimeTask
→ Task Dispatcher
→ Tool Gateway
→ Approval / Audit / Policy
→ 实际执行
```

避免出现“某些路径走审批，某些路径直接执行”的不一致。

## PR-00：Gateway `/task` 审批路径闭环

状态：已完成。

### 问题

Gateway `/task <workspacePath> :: <objective>` 曾经直接调用 `startClaudeCodeTask`，绕过 RuntimeTask / Dispatcher / Tool Gateway。

### 已完成内容

- `src/gateway/message-handler.ts`
  - `/task` 改为创建 `code.claude_code_task` RuntimeTask。
  - 调用 `dispatchRuntimeTask(task.id)`。
  - 未审批时进入 `waiting_user_confirm`。
- `tests/gateway-message-handler.test.ts`
  - 覆盖 `/task` 创建审批门禁 RuntimeTask。
- 同步更新：
  - `README.md`
  - `docs/GAP.md`
  - `docs/channels/HTTP.md`
  - `docs/agents/TASK_AGENT.md`
  - `docs/agents/CODE_AGENT.md`

### 验证结果

- `npm test -- tests/gateway-message-handler.test.ts tests/task-dispatcher.test.ts` 通过。
- `npm run typecheck` 通过。
- `npm run verify:change-sync` 通过。
- `npm run verify` 通过。
- `gitnexus_detect_changes(scope=all)`：risk low，仅触达 `handleTaskCommand`。

---

## PR-01：Workflow 高危能力统一走 Tool Gateway

状态：已完成。

### 目标

审查所有 Mastra workflow，确认是否还有绕过 Tool Gateway 的高危能力调用。

### 范围

重点检查：

- `src/mastra/workflows/code-task-workflow.ts`
- `src/mastra/workflows/memory-maintenance-workflow.ts`
- `src/mastra/workflows/task-orchestration-workflow.ts`
- `src/mastra/workflows/*`

### 本次审查结论

- `code-task-workflow.ts` 已经通过 `executeWithToolGateway` 包裹 `startClaudeCodeTask`。
- 当前明确绕过点是 `memory-maintenance-workflow.ts` 直接调用 `appendEpisodicLog`、`writeDocUpdateProposal`、`updateMemoryIndex`。
- `memory-maintenance-workflow.ts` 文件级 GitNexus impact 为 LOW，直接影响 `src/mastra/workflows/index.ts`。

### 已完成内容

- `src/mastra/workflows/memory-maintenance-workflow.ts`
  - 新增 `runMemoryMaintenance` 可测试执行函数。
  - workflow step 复用该函数。
  - `appendEpisodicLog`、`writeDocUpdateProposal`、`updateMemoryIndex` 均通过 `executeWithToolGateway` 审计。
- `tests/memory-maintenance-workflow.test.ts`
  - 验证 memory workflow 三个写操作都生成 Tool Gateway audit record。
- `docs/knowledge/TOOLS.md`
  - 记录 memory maintenance workflow 使用 `memory.write` capability 进入 Tool Gateway audit。

### 验证结果

```bash
npm test -- tests/memory-maintenance-workflow.test.ts tests/tool-gateway.test.ts tests/tool-approval-policy.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
```

结果：全部通过。完整验证为 16 个 test files / 58 个 tests 通过。

GitNexus `detect_changes(scope=all)`：risk low，无 affected processes。

---

## PR-02：Tool Gateway capability 默认语义收紧

状态：已完成。

### 目标

当前 capability 检查需要确认：当调用上下文缺少 `capabilities` 时，是默认允许还是默认拒绝。为了安全边界一致，需要制定清晰规则。

### 设计原则

- 内部明确可信路径可以显式声明 system capability。
- 外部入口、Gateway、Scheduler、Runtime dispatch 不能因为缺省 capabilities 而绕过检查。
- 需要兼容现有测试和工具调用。

### 本次策略

- `safe` / `medium` 暂保持兼容，避免误伤读/list/普通维护路径。
- `dangerous` 且不需要审批的调用，必须提供匹配 capability 或 approval token。
- `dangerous` 且 `requireApproval: true` 的调用仍优先走审批请求，避免破坏现有 approval flow。

### 已完成内容

- `src/mastra/runtime/tool-gateway.ts`
  - 收紧 `validateCapability`：dangerous 非审批调用缺少 matching capability 时阻断。
- `tests/tool-gateway.test.ts`
  - 增加 dangerous 缺省 capability 阻断测试。
  - 增加 dangerous 显式 capability 放行测试。
  - 更新失败调用测试，显式提供 capability 后验证失败 audit。
- `docs/knowledge/TOOLS.md`
  - 记录 dangerous non-approval 调用的 capability 规则。

### 验收标准

- 缺少 capability 的 dangerous 非审批调用不会默认放行。
- approval-required dangerous 调用仍生成审批请求。
- 低风险 read/list 类工具不被误伤。
- 测试覆盖：允许、拒绝、审批、audit 四类路径。

### 验证结果

```bash
npm test -- tests/tool-gateway.test.ts tests/tool-approval-policy.test.ts tests/task-dispatcher.test.ts tests/gateway-message-handler.test.ts
npm run typecheck
npm run verify
```

结果：全部通过。完整验证为 16 个 test files / 60 个 tests 通过。

GitNexus `detect_changes(scope=all)`：risk low，无 affected processes。

---

## PR-03：审批恢复链路端到端测试

状态：待执行。

### 目标

补齐从审批请求创建到审批通过、RuntimeTask 回到 `pending` 的端到端验证。

### 范围

- `src/mastra/runtime/approval-store.ts`
- `src/mastra/runtime/task-runtime.ts`
- `src/mastra/runtime/task-dispatcher.ts`
- Gateway `/task` 或 schedule direct code 测试路径。

### 验收标准

- 未审批：`waiting_user_confirm`。
- 审批通过：payload 注入 `approvalToken`，任务回到 `pending`。
- 审批拒绝：任务进入 rejected/cancelled 或约定失败状态。
- 不实际 spawn Claude Code，使用 dry-run 或 patch-proposal 验证恢复链路。

---

## PR-04：RuntimeTask / TeamTask 状态一致性审计

状态：待执行。

### 目标

确保 RuntimeTask 与兼容 TeamTask 的状态、metadata、event log 不冲突。

### 验收标准

- RuntimeTask 是生命周期主源。
- TeamTask 兼容层不被业务代码直接写 `runtimeStatus`。
- event log 能解释每次状态转换。
- 增加一致性测试。

---

# M1：最小记忆与上下文骨架

## 目标

在不引入复杂向量库和 Memory Tree 的前提下，让 OmniAgent 能稳定生成任务所需上下文包。

```text
用户偏好
+ 项目目标
+ 当前任务目标
+ 相关文档
+ token budget
→ context-pack.json
```

## PR-05：Memory Skeleton 现状整理与最小目录固化

状态：待执行。

### 目标

整理现有 `docs/knowledge/*`、`.omc/wiki/*`、项目 memory、运行时 memory 的边界，不重复造一套混乱目录。

### 验收标准

- 明确哪些是用户长期记忆。
- 明确哪些是项目知识。
- 明确哪些是任务过程记录。
- 明确 memory proposal 不直接写入核心记忆。
- 文档写入 `docs/knowledge` 或 `.omc` 对应位置。

---

## PR-06：Context Pack Schema + Builder MVP

状态：待执行。

### 目标

实现最小 `context-pack`：输入任务类型和目标，输出结构化上下文包。

### 预期目录

```text
src/mastra/runtime/context-pack/
  context-pack.schema.ts
  context-pack-builder.ts
  context-pack-loader.ts
```

### 验收标准

- 输入 `requirement_e2e` 任务能生成 context pack。
- 包含用户偏好、项目目标、当前任务目标、相关文档列表、token budget。
- 有单元测试。

---

## PR-07：ContextJuice 简版

状态：待执行。

### 目标

先做简单压缩，不做复杂智能摘要。

### 第一批压缩器

- git diff 摘要
- test log 摘要
- doc summary 摘要
- context budget 计算

### 验收标准

- 测试失败日志保留失败原因。
- 成功日志可压缩。
- diff 摘要包含变更文件和风险提示。
- 输出带 evidence ref。

---

## PR-08：Memory Proposal MVP

状态：待执行。

### 目标

任务完成后生成 memory proposal，而不是直接写长期记忆。

### 验收标准

- 可生成 proposal 文件。
- proposal 区分 user/project/lesson/reference 类型。
- 未确认内容不进入长期记忆。
- 有测试覆盖。

---

# M2：需求 E2E MVP 产物链路

## 目标

跑通 AI 应用工程师需求输入后的完整产物链路：

```text
需求输入
→ 需求分析
→ 4+1 设计
→ 代码影响面分析
→ 开发计划
→ patch proposal
→ 测试计划
→ 提测材料
→ memory proposal
```

## PR-09：RequirementE2E Run 目录与 artifact writer

状态：待执行。

### 目标

先不追求智能，先固化产物目录和写入协议。

### 目录

```text
.omni/runs/requirement-e2e/{taskId}/
  input.md
  context-pack.json
  requirement-analysis.md
  repo-impact-report.md
  design-4plus1.md
  dev-plan.md
  patch-proposal.diff
  test-plan.md
  delivery-doc.md
  memory-proposal.md
  final-summary.md
```

### 验收标准

- 给定 taskId 和输入，能创建完整 artifact skeleton。
- 中断后能检测已有 artifact 并继续。

---

## PR-10：PlannerAgent / Requirement Analyzer MVP

状态：待执行。

### 目标

将需求拆成阶段、风险、审批点、验收标准。

### 验收标准

- 输入一个需求，生成 `requirement-analysis.md` 和 `dev-plan.md`。
- 输出结构稳定，适合后续 agent 消费。

---

## PR-11：ArchitectAgent 4+1 设计模板

状态：待执行。

### 目标

生成 4+1 设计文档骨架。

### 验收标准

- 包含 Logical / Process / Development / Physical / Scenarios。
- 明确模块边界、接口、风险。
- 不需要自动保证方案最优，但结构必须稳定。

---

## PR-12：RepoImpact MVP

状态：待执行。

### 目标

把 GitNexus impact/query/context 结果落到 `repo-impact-report.md`。

### 验收标准

- 输入需求和候选 symbol，生成影响面报告。
- HIGH/CRITICAL 风险有明确停顿点。
- 测试覆盖报告格式。

---

## PR-13：TestReview MVP

状态：待执行。

### 目标

生成测试计划、测试结果摘要、提测材料。

### 验收标准

- 能读取测试命令输出摘要。
- 生成 `test-plan.md`、`delivery-doc.md`、`final-summary.md`。

---

# M3：长任务与工作编排增强

## 目标

让任务可长期运行、失败可恢复、过程可审计。

## PR-14：WorkspaceManager MVP

状态：待执行。

### 验收标准

- 每个长任务有 workspace。
- workspace 记录 context pack、plan、event log、artifacts、proof-of-work。

---

## PR-15：Proof of Work 标准化

状态：待执行。

### 验收标准

每个完成任务输出：

- 做了什么
- 改了哪些文件
- 生成了哪些产物
- 跑了哪些测试
- 通过/失败情况
- 剩余风险
- 下一步建议

---

## PR-16：Retry / Reconcile 增强

状态：待执行。

### 验收标准

- 中断任务可识别。
- running 超时可转 interrupted/timed_out。
- retry 有明确来源和新任务关系。

---

# M4：记忆系统增强与知识自更新

## PR-17：SQLite Memory Index MVP

状态：待执行。

目标：Markdown Vault + SQLite FTS/BM25，不做向量库优先。

## PR-18：Profile Facets MVP

状态：待执行。

目标：用户偏好具备 confidence、source、updated_at。

## PR-19：Memory Consolidation Report

状态：待执行。

目标：定期整理候选记忆，但不自动污染核心记忆。

## PR-20：OmniResearch Loop Skeleton

状态：待执行。

目标：围绕长期目标定时研究，输出 evidence、gap analysis、proposal、blog draft、memory proposal。

---

# M5：内部系统 / MCP / A2A / 手机端接入

## PR-21：MCP Gateway Skeleton

状态：待执行。

## PR-22：Internal Demand Adapter MVP

状态：待执行。

## PR-23：CI/Test Adapter MVP

状态：待执行。

## PR-24：Mobile Approval / Notification Channel

状态：待执行。

---

# M6：产品化、评估与持续演进

## PR-25：Eval Harness MVP

状态：待执行。

## PR-26：Runtime Dashboard Data API

状态：待执行。

## PR-27：Agent / Workflow Registry

状态：待执行。

## PR-28：Tool Policy Center

状态：待执行。

---

## 5. 当前执行状态

```text
当前阶段：M0 安全边界闭环
当前优先级：PR-03 审批恢复链路端到端测试
上一步完成：PR-02 Tool Gateway capability 默认语义收紧
下一步建议：补齐 approval request 创建、approve/reject、RuntimeTask 状态恢复的端到端测试
```

## 6. 中断恢复步骤

如果任务中断，恢复时按以下顺序：

1. 阅读本文件。
2. 查看“当前执行状态”。
3. 运行 `git status` 查看未提交变更。
4. 如有未完成 PR 切片，先跑对应 focused tests。
5. 继续当前 PR 的第一个未完成验收项。
6. 每完成一个 PR：
   - 更新本文件状态。
   - 记录验证命令和结果。
   - 运行 `gitnexus_detect_changes(scope=all)`。
   - 等用户确认后再进入下一 PR。

## 7. 待用户确认的问题

在开始 PR-01 前，需要确认：

1. 是否接受本计划的阶段划分和 PR 顺序？
2. PR-01 是否就按“审查并修复 workflow 高危绕过 Tool Gateway”开始？
3. 完成每个 PR 后，是否需要我自动停下等待确认，再进入下一 PR？

