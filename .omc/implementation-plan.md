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
→ M3：Goal Runtime 与长任务工作编排增强
→ M4：Memory / Knowledge Platform 增强
→ M5：OpenHuman-like Core 扩展
→ M6：产品化、评估与持续演进
```

当前优先级：**M2 已完成，进入 M3 Goal Runtime MVP**。

原因：OmniAgent 最终会执行本地代码、读取记忆、连接外部系统和长期运行任务。如果安全边界、审批、审计和任务状态先不统一，后续记忆/E2E/长任务能力越强，风险越高。当前 M0-M2 已把安全闭环、最小上下文、需求 E2E artifact 链路打稳，下一步应把长期目标推进抽象为统一 Goal Runtime，而不是为每个长期任务单独写 scheduler / memory / push / feedback。

## 2.1 Goal Runtime 补充原则

本轮路线补充的核心结论：两个急迫场景——主题型长期研究任务、模块型改进任务——本质上应共享同一个 `Persistent Goal Runtime`。

错误方向：

```text
AI 长记忆研究任务一套 scheduler / memory / push / feedback
OmniAgent 模块改进任务另一套 scheduler / memory / push / feedback
```

正确方向：

```text
OmniAgent Core Platform
  ├─ Goal Engine
  ├─ Workflow Engine
  ├─ Connector Engine
  ├─ Memory Engine
  ├─ Artifact Engine
  ├─ Feedback Engine
  ├─ Notification Engine
  ├─ Model Router
  └─ Tool Gateway

Scenarios
  ├─ Topic Research Goal
  └─ Module Improvement Goal
```

落地架构采用：

```text
Workflow-first + Few-Agent + Skill-based + Memory-driven
```

推荐运行形态：

```text
GoalOrchestratorAgent
  负责目标状态、阶段判断、预算控制、下一步决策

ResearchAnalysisAgent
  负责研究、代码仓分析、论文/博客/项目对比、洞察提炼

WriterAgent
  负责日报、wiki、博客、4+1 设计文档、落地计划生成

EvaluatorNode
  非常驻 Agent，只在 run 结束、阶段切换、正式文档生成前触发

Skills / Nodes
  GitHubSearchSkill
  ArxivSearchSkill
  BlogSearchSkill
  RepoReadSkill
  DedupNode
  RankNode
  WikiUpdateSkill
  DesignDocSkill
  QQPushSkill
  FeedbackParseSkill
```

Agent 不按“职责名词”拆，而按“是否需要独立推理主体”拆。

长期方向上，OmniAgent 从长期目标和研发作业流出发，逐步补齐全域个人上下文摄取、Connector 四象限模型、Memory Tree、Obsidian / Markdown 双向记忆、Tool Output Compression Gateway、Model Router、本地权限与安全边界、桌面端 / 手机端 / 语音 / 会议能力，演进为本地个人 AI 操作系统。

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

状态：已完成。

### 目标

补齐从审批请求创建到审批通过、RuntimeTask 回到 `pending` 的端到端验证。

### 范围

- `src/mastra/runtime/approval-store.ts`
- `src/mastra/runtime/task-runtime.ts`
- `src/mastra/runtime/task-dispatcher.ts`
- Gateway `/task` 或 schedule direct code 测试路径。

### 已完成内容

- `tests/approval-store.test.ts`
  - 保留 approve 链路测试：approval token 注入 payload，RuntimeTask 回到 `pending`。
  - 新增 reject 链路测试：pending approval 被拒绝后，linked RuntimeTask 转为 `cancelled`。
- `docs/knowledge/TOOLS.md`
  - 明确 approval approve/reject 对 RuntimeTask 的状态影响。

### 验收标准

- 未审批：`waiting_user_confirm` 已由 gateway/dispatcher 测试覆盖。
- 审批通过：payload 注入 `approvalToken`，任务回到 `pending`。
- 审批拒绝：任务进入 `cancelled`。
- 不实际 spawn Claude Code。

### 验证命令

```bash
npm test -- tests/approval-store.test.ts tests/gateway-message-handler.test.ts tests/task-dispatcher.test.ts
npm run verify
```

---

## PR-04：RuntimeTask / TeamTask 状态一致性审计

状态：已完成。

### 目标

确保 RuntimeTask 与兼容 TeamTask 的状态、metadata、event log 不冲突。

### 本次审查结论

- `taskRuntime.transition` 的 GitNexus impact 为 CRITICAL：19 个直接调用、6 条流程受影响。
- 因此本片不修改状态机实现，只补一致性回归测试和文档审计，避免触碰高风险行为。
- RuntimeTask record 是生命周期主源，TeamTask metadata 作为兼容镜像。
- 对 `retrying` 等 RuntimeTask-only 状态，TeamTask status 可能保持最接近的 legacy 值，真实 runtime 状态以 metadata 和 RuntimeTask record 为准。

### 已完成内容

- `tests/task-runtime.test.ts`
  - 新增 running → succeeded 路径一致性测试。
  - 验证 RuntimeTask record、TeamTask metadata、runtime event log 的 status/reason/previousRuntimeStatus 同步。
  - 扩展 failed → retrying → retry task 测试，验证原任务和 retry task 的 RuntimeTask/TeamTask 兼容 metadata 对齐。
- `docs/ARCHITECTURE.md`
  - 明确 RuntimeTask 是用户可见生命周期主源，TeamTask metadata 是兼容镜像。
- `docs/TESTING.md`
  - 更新 TaskRuntime 当前测试覆盖。
- `docs/GAP.md`
  - 记录本片 verified slice 和 CRITICAL impact 决策。

### 验收标准

- RuntimeTask 是生命周期主源。
- TeamTask 兼容层不被业务代码直接写 `runtimeStatus`。
- event log 能解释每次状态转换。
- 增加一致性测试。

### 验证结果

```bash
npm test -- tests/task-runtime.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。完整验证为 16 个 test files / 62 个 tests 通过。GitNexus detect_changes：risk low，changed_symbols 仅 `tests/task-runtime.test.ts:loadTaskRuntime` 与 `docs/TESTING.md` section，无 affected processes。

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

状态：已完成。

### 目标

整理现有 `docs/knowledge/*`、`.omc/wiki/*`、项目 memory、运行时 memory 的边界，不重复造一套混乱目录。

### 本次整理结论

- `~/.omni/memory/**` 是规范长期记忆与索引位置。
- `docs/knowledge/**` 是随代码一起评审的项目知识位置。
- `.omc/wiki/**` 是本地 operator wiki / session synthesis，不作为 runtime canonical memory。
- `~/.omni/runs/**` 是任务过程记录、审计和 artifacts，不默认提升为长期知识。
- Mastra LibSQL memory 仅用于 agent 对话连续性，不作为长期记忆或项目文档。
- memory proposal 写入 `~/.omni/memory/doc-update-proposals.jsonl`；未确认内容不进入稳定记忆或项目知识。

### 已完成内容

- `docs/knowledge/PROJECTS.md`
  - 新增 Memory And Knowledge Boundaries。
  - 明确长期记忆、项目知识、任务过程记录、operator wiki、Mastra conversation memory 的边界。
  - 明确 explicit user fact 可直写、推断/高风险更新走 proposal。
- `docs/agents/KNOWLEDGE_AGENT.md`
  - 补充 `.omc/wiki/**` 不是 runtime canonical memory。
- `docs/CONTEXT_PACKS.md`
  - Docs Memory context pack 纳入 `docs/knowledge/PROJECTS.md`。

### 验收标准

- 明确哪些是用户长期记忆。
- 明确哪些是项目知识。
- 明确哪些是任务过程记录。
- 明确 memory proposal 不直接写入核心记忆。
- 文档写入 `docs/knowledge` 或 `.omc` 对应位置。

### 验证结果

```bash
npm run verify:change-sync
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。完整验证为 16 个 test files / 63 个 tests 通过。GitNexus detect_changes：risk low，4 个文档文件变更，无 changed symbols / affected processes。

---

## PR-06：Context Pack Schema + Builder MVP

状态：已完成。

### 目标

实现最小 `context-pack`：输入任务类型和目标，输出结构化上下文包。

### 已完成内容

- `src/mastra/runtime/context-pack/context-pack.schema.ts`
  - 定义 `requirement_e2e` context pack schema。
  - 固化 task、user、project、documents、tokenBudget 字段。
- `src/mastra/runtime/context-pack/context-pack-builder.ts`
  - 新增 `buildContextPack`。
  - 从 `memory/USER.md` 读取用户偏好和 profile facts。
  - 从 `docs/knowledge/PROJECTS.md` 读取项目目标和 memory/knowledge boundaries。
  - 为 `requirement_e2e` 选择最小相关文档列表。
- `src/mastra/runtime/context-pack/context-pack-loader.ts`
  - 新增 `loadContextPack` / `writeContextPack` 并通过 schema 校验。
- `src/mastra/runtime/index.ts`
  - 导出 context-pack runtime API。
- `tests/context-pack.test.ts`
  - 覆盖 `requirement_e2e` pack 生成。
  - 覆盖写入/读取时的 schema validation。
- `docs/CONTEXT_PACKS.md`
  - 记录 Context Pack Runtime MVP 的输入来源、输出内容和 API。

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

### 验证结果

```bash
npm test -- tests/context-pack.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。Focused test 为 1 个 test file / 2 个 tests 通过；完整验证为 17 个 test files / 65 个 tests 通过。GitNexus detect_changes：risk low，无 changed symbols / affected processes。

---

## PR-07：ContextJuice 简版

状态：已完成。

### 目标

先做简单压缩，不做复杂智能摘要。

### 第一批压缩器

- git diff 摘要
- test log 摘要
- doc summary 摘要
- context budget 计算

### 已完成内容

- `src/mastra/runtime/context-pack/context-juice.ts`
  - 新增 deterministic ContextJuice 简版摘要器。
  - `summarizeGitDiff` 输出变更文件、基础风险提示和 evidence ref。
  - `summarizeTestLog` 失败时保留失败原因，成功时压缩为通过计数摘要。
  - `summarizeDoc` 提取标题和 bullet/body 摘要。
  - `calculateContextBudget` 计算可用上下文、估算已用 token、剩余 token 和 section 明细。
- `src/mastra/runtime/context-pack/index.ts`、`src/mastra/runtime/index.ts`
  - 导出 ContextJuice runtime API 和类型。
- `tests/context-pack.test.ts`
  - 保留 PR-06 context pack 生成/读写测试。
  - 新增 ContextJuice 覆盖：失败日志、成功日志、diff 风险提示、doc summary、context budget、evidence ref。
- `docs/CONTEXT_PACKS.md`
  - 记录 ContextJuice runtime 用法和 evidence ref 约定。

### 验收标准

- 测试失败日志保留失败原因。
- 成功日志可压缩。
- diff 摘要包含变更文件和风险提示。
- 输出带 evidence ref。

### 验证结果

```bash
npm test -- tests/context-pack.test.ts
npm run typecheck
npm run verify
```

结果：全部通过。Focused test 为 1 个 test file / 6 个 tests 通过；完整验证为 17 个 test files / 69 个 tests 通过，`verify:change-sync` 通过。

---

## PR-08：Memory Proposal MVP

状态：已完成。

### 目标

任务完成后生成 memory proposal，而不是直接写长期记忆。

### 已完成内容

- `src/mastra/lib/docs-memory.ts`
  - `DocUpdateProposal` 增加 `proposalType`，类型为 `user` / `project` / `lesson` / `reference`。
  - `writeDocUpdateProposal` 生成 `memory-proposal-*` id，并继续追加写入 `~/.omni/memory/doc-update-proposals.jsonl`。
  - 未显式传入 `proposalType` 时，根据目标文件推断 proposal 类型。
- `src/mastra/tools/memory-tools.ts`
  - `propose-doc-update` tool input/output schema 支持 typed memory proposal。
- `src/mastra/workflows/memory-maintenance-workflow.ts`
  - workflow proposal input 支持 typed memory proposal。
- `tests/docs-memory.test.ts`
  - 覆盖 proposal 文件生成、JSONL 持久化、类型区分，以及未确认内容不进入 `USER.md`。
- `docs/agents/KNOWLEDGE_AGENT.md`、`docs/knowledge/PROJECTS.md`
  - 记录 typed reviewable proposal 约定。

### 验收标准

- 可生成 proposal 文件。
- proposal 区分 user/project/lesson/reference 类型。
- 未确认内容不进入长期记忆。
- 有测试覆盖。

### 验证结果

```bash
npm test -- tests/docs-memory.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
```

结果：全部通过。Focused test 为 1 个 test file / 3 个 tests 通过；完整验证为 17 个 test files / 71 个 tests 通过，`verify:change-sync` 通过。

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

状态：已完成。

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

### 已完成内容

- `src/mastra/runtime/requirement-e2e-artifacts.ts`
  - 新增 `createRequirementE2ERun`，给定 `taskId` 和输入创建完整 artifact skeleton。
  - 新增 `inspectRequirementE2ERun`，返回 existing/missing artifacts 用于中断恢复。
  - 已存在 artifact 不覆盖，只补齐缺失文件。
  - 限制 taskId 只能使用安全字符，避免路径逃逸。
- `src/mastra/lib/paths.ts`、`src/mastra/runtime/index.ts`
  - 增加 RequirementE2E runs root 和 runtime exports。
- `tests/requirement-e2e-artifacts.test.ts`
  - 覆盖 skeleton 创建、context-pack 写入、恢复检测、不覆盖已有 artifact、非法 taskId 拒绝。
- `docs/CONTEXT_PACKS.md`
  - 记录 RequirementE2E run artifacts 目录和恢复协议。

### 验收标准

- 给定 taskId 和输入，能创建完整 artifact skeleton。
- 中断后能检测已有 artifact 并继续。

### 验证结果

```bash
npm test -- tests/requirement-e2e-artifacts.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
```

结果：全部通过。Focused test 为 1 个 test file / 3 个 tests 通过；完整验证为 18 个 test files / 74 个 tests 通过，`verify:change-sync` 通过。

---

## PR-10：PlannerAgent / Requirement Analyzer MVP

状态：已完成。

### 目标

将需求拆成阶段、风险、审批点、验收标准。

### 已完成内容

- `src/mastra/runtime/requirement-e2e-artifacts.ts`
  - 新增 `buildRequirementPlanningArtifacts`，从需求、assumptions、context pack 生成稳定结构的需求分析和开发计划。
  - 新增 `writeRequirementPlanningArtifacts`，写入 `requirement-analysis.md` 和 `dev-plan.md`。
- `src/mastra/runtime/index.ts`
  - 导出 RequirementE2E planning runtime API 和类型。
- `tests/requirement-e2e-artifacts.test.ts`
  - 覆盖 requirement analysis / dev plan 写入、稳定章节、context pack document 引用。
- `docs/CONTEXT_PACKS.md`
  - 记录 deterministic planner step 和稳定 artifact sections。

### 验收标准

- 输入一个需求，生成 `requirement-analysis.md` 和 `dev-plan.md`。
- 输出结构稳定，适合后续 agent 消费。

### 验证结果

```bash
npm test -- tests/requirement-e2e-artifacts.test.ts
npm run typecheck
npm run verify:change-sync
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。Focused test 为 1 个 test file / 4 个 tests 通过；完整验证为 18 个 test files / 74 个 tests 通过，`verify:change-sync` 通过。GitNexus detect_changes：risk low，无 affected processes。

---

## PR-11：ArchitectAgent 4+1 设计模板

状态：已完成。

### 目标

生成 4+1 设计文档骨架。

### 已完成内容

- `src/mastra/runtime/requirement-e2e-artifacts.ts`
  - 新增 `buildDesign4Plus1Artifact`，生成 Logical / Process / Development / Physical / Scenarios 稳定 4+1 设计视图。
  - 新增 `writeDesign4Plus1Artifact`，写入 `design-4plus1.md`。
- `src/mastra/runtime/index.ts`
  - 导出 4+1 design runtime API 和类型。
- `tests/requirement-e2e-artifacts.test.ts`
  - 覆盖 4+1 artifact 写入、稳定章节、planner output 标记和 decisions。
- `docs/CONTEXT_PACKS.md`
  - 记录 deterministic architect step。

### 验收标准

- 包含 Logical / Process / Development / Physical / Scenarios。
- 明确模块边界、接口、风险。
- 不需要自动保证方案最优，但结构必须稳定。

### 验证结果

```bash
npm test -- tests/requirement-e2e-artifacts.test.ts
npm run typecheck
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。Focused test 为 1 个 test file / 5 个 tests 通过；完整验证为 18 个 test files / 76 个 tests 通过，`verify:change-sync` 通过。GitNexus detect_changes：risk low，无 affected processes。

---

## PR-12：RepoImpact MVP

状态：已完成。

### 目标

把 GitNexus impact/query/context 结果落到 `repo-impact-report.md`。

### 已完成内容

- `src/mastra/runtime/requirement-e2e-artifacts.ts`
  - 新增 `buildRepoImpactReportArtifact`，从候选 symbol impact 结果生成稳定 repo impact report。
  - 新增 `writeRepoImpactReportArtifact`，写入 `repo-impact-report.md`。
  - 支持 LOW/MEDIUM/HIGH/CRITICAL 风险排序，HIGH/CRITICAL 标记 `requiresApproval` 并写入 STOP 条件。
- `src/mastra/runtime/index.ts`
  - 导出 RepoImpact runtime API 和类型。
- `tests/requirement-e2e-artifacts.test.ts`
  - 覆盖 repo impact report 写入、highest risk、requiresApproval、affected processes 和 STOP 条件。
- `docs/CONTEXT_PACKS.md`
  - 记录 deterministic repository-impact step。

### 验收标准

- 输入需求和候选 symbol，生成影响面报告。
- HIGH/CRITICAL 风险有明确停顿点。
- 测试覆盖报告格式。

### 验证结果

```bash
npm test -- tests/requirement-e2e-artifacts.test.ts
npm run typecheck
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。Focused test 为 1 个 test file / 6 个 tests 通过；完整验证为 18 个 test files / 77 个 tests 通过，`verify:change-sync` 通过。GitNexus detect_changes：risk low，无 affected processes。

---

## PR-13：TestReview MVP

状态：已完成。

### 目标

生成测试计划、测试结果摘要、提测材料。

### 已完成内容

- `src/mastra/runtime/requirement-e2e-artifacts.ts`
  - 新增 `buildTestReviewArtifacts`，从测试命令摘要和 repo-impact approval 状态生成 test plan、delivery doc、final summary。
  - 新增 `writeTestReviewArtifacts`，写入 `test-plan.md`、`delivery-doc.md`、`final-summary.md`。
  - 支持 failed / not_run / repo impact approval pending 的 remaining actions。
- `src/mastra/runtime/index.ts`
  - 导出 TestReview runtime API 和类型。
- `tests/requirement-e2e-artifacts.test.ts`
  - 覆盖 test review artifact 写入、ready / blocked delivery 状态、final summary remaining actions。
- `docs/CONTEXT_PACKS.md`
  - 记录 deterministic test-review step。

### 验收标准

- 能读取测试命令输出摘要。
- 生成 `test-plan.md`、`delivery-doc.md`、`final-summary.md`。

### 验证结果

```bash
npm test -- tests/requirement-e2e-artifacts.test.ts
npm run typecheck
npm run verify
gitnexus_detect_changes(scope=all)
```

结果：全部通过。Focused test 为 1 个 test file / 8 个 tests 通过；完整验证为 18 个 test files / 79 个 tests 通过，`verify:change-sync` 通过。GitNexus detect_changes：risk low，无 affected processes。

---

# M3：Goal Runtime 与长任务工作编排增强

## 目标

把 OmniAgent 从“单次任务执行器”升级为“长期目标推进系统”：让任务可长期运行、失败可恢复、过程可审计，并支持围绕长期目标持续探索、沉淀知识、生成 artifact、接收用户反馈后继续推进。

两个第一批高价值场景：

1. 主题型长期研究任务：围绕主题定时探索 GitHub / 论文 / 博客 / 新闻 / RSS，去重、排序、分析、知识沉淀，逐步生成 wiki / 博客 / 改进方案，并通过 QQbot 或 mock channel 推送反馈。
2. 模块型改进任务：围绕 OmniAgent 某个模块主动探索外部仓库和资料，对比当前实现 gap，生成 4+1 设计文档、落地计划和任务拆解，经用户确认后进入开发闭环。

---

## PR-14：Goal WorkspaceManager MVP

状态：已完成。

### 目标

为长期目标建立统一数据模型和 workspace，避免为不同长期任务分别实现独立调度、记忆、推送和反馈链路。

### 建议模型

```ts
type GoalType =
  | "topic_research"
  | "module_improvement"
  | "personal_assistant"
  | "workflow_automation";

type GoalStatus =
  | "active"
  | "paused"
  | "waiting_feedback"
  | "completed"
  | "failed";

interface Goal {
  id: string;
  type: GoalType;
  title: string;
  objective: string;
  scope: string[];
  status: GoalStatus;
  cadence?: string;
  sources: string[];
  artifactPolicy: string[];
  feedbackPolicy: string;
  createdAt: string;
  updatedAt: string;
}
```

### 目录

```text
.omni/goals/{goalId}/
  goal.json
  capsule.md
  runs/
  evidence/
  artifacts/
  feedback.jsonl
  event-log.jsonl
```

### 预期交付

```text
src/mastra/runtime/goal/
  goal.schema.ts
  goal-store.ts
  goal-workspace.ts

tests/goal-runtime.test.ts
docs/GOAL_RUNTIME.md
```

### 验收标准

- 可以创建 Goal。
- 可以读取 Goal。
- 可以暂停 / 恢复 Goal。
- 每个 Goal 有独立 workspace。
- workspace 不允许路径逃逸。
- 有单元测试。

---

## PR-15：GoalRun Proof of Work 标准化

状态：已完成。

### 目标

每次长期目标执行都必须有可审计的 GoalRun 和 Proof of Work。

### 建议模型

```ts
interface GoalRun {
  id: string;
  goalId: string;
  status:
    | "pending"
    | "running"
    | "waiting_feedback"
    | "succeeded"
    | "failed"
    | "interrupted"
    | "cancelled";
  plan?: unknown;
  summary?: string;
  proofOfWork?: ProofOfWork;
  startedAt?: string;
  finishedAt?: string;
}

interface ProofOfWork {
  did: string[];
  sourcesRead: string[];
  artifactsCreated: string[];
  memoryProposals: string[];
  testsRun: string[];
  risks: string[];
  nextActions: string[];
}
```

### 预期交付

```text
src/mastra/runtime/goal/
  goal-run.schema.ts
  goal-run-store.ts
  proof-of-work.ts
```

### 验收标准

- 每次 run 都有状态。
- 每次 run 都有 event log。
- 成功 run 必须有 proof-of-work。
- 失败 run 必须记录失败原因。
- 中断后可恢复。

---

## PR-16：Goal Retry / Reconcile 增强

状态：已完成。

### 目标

让长期目标可中断、可恢复、可重试。

### 预期交付

```text
src/mastra/runtime/goal/
  goal-reconciler.ts
  goal-retry.ts
  goal-timeout-policy.ts
```

### 验收标准

- running 超时后可转 interrupted。
- failed run 可 retry。
- retry run 记录 parentRunId。
- reconcile 不重复执行已完成 artifact。

---

## PR-17：Topic Research Goal MVP

状态：已完成。

### 目标

跑通第一类长任务：主题型长期研究。

### 示例目标

```text
AI 工程中如何构建好的长记忆系统
```

### Workflow

```text
Load Goal
→ Build Goal Capsule
→ Search GitHub / arXiv / Blog / RSS
→ Dedup
→ Rank
→ Analyze Top Sources
→ Generate Daily Digest
→ Update Wiki Draft
→ Generate Memory Proposal
→ Push to QQ 或 mock channel
→ Wait Feedback
```

### 预期交付

```text
src/mastra/workflows/topic-research-goal-workflow.ts

src/mastra/skills/research/
  github-search-skill.ts
  arxiv-search-skill.ts
  blog-search-skill.ts
  rss-search-skill.ts

src/mastra/runtime/evidence/
  evidence.schema.ts
  evidence-store.ts
  dedup.ts
  rank.ts
```

### 产物目录

```text
.omni/goals/{goalId}/runs/{runId}/
  plan.md
  sources.json
  evidence.jsonl
  daily-digest.md
  wiki-diff.md
  memory-proposal.md
  proof-of-work.md
```

### 验收标准

- 输入一个 `topic_research` goal。
- 可以生成一次 daily digest。
- 可以保存 evidence。
- 可以去重。
- 可以生成 wiki-diff。
- 可以生成 proof-of-work。
- 第一版可先 mock push，不要求接真实 QQbot。

---

## PR-18：Module Improvement Goal MVP

状态：已完成。

### 目标

跑通第二类长任务：OmniAgent 模块改进任务。

### 示例目标

```text
针对 OmniAgent memory 模块，探索 GitHub 热点仓库，输出改进设计文档和落地计划。
```

### Workflow

```text
Load Goal
→ Load Local Module Context
→ Search Related GitHub Repos
→ Read README / docs / key source files
→ Compare with OmniAgent current module
→ Generate Gap Analysis
→ Generate 4+1 Design Draft
→ Generate Implementation Plan
→ Push Summary
→ Wait Feedback
```

### 预期交付

```text
src/mastra/workflows/module-improvement-goal-workflow.ts

src/mastra/skills/repo/
  github-repo-search-skill.ts
  repo-read-skill.ts
  repo-compare-skill.ts

src/mastra/runtime/module-analysis/
  module-context-builder.ts
  gap-analysis-builder.ts
```

### 产物目录

```text
.omni/goals/{goalId}/runs/{runId}/
  candidate-repos.json
  repo-analysis.md
  gap-analysis.md
  design-4plus1.md
  implementation-plan.md
  proof-of-work.md
```

### 验收标准

- 输入 `module_improvement` goal。
- 能读取本地模块上下文。
- 能生成候选 GitHub repo 列表。
- 能生成 `gap-analysis.md`。
- 能生成 `design-4plus1.md`。
- 能生成 `implementation-plan.md`。

---

## PR-19：QQbot Feedback Loop MVP

状态：已完成。

### 目标

把每日推送和用户反馈闭环打通。第一版可以先不接真实 QQbot，支持 CLI/mock feedback。

### 建议模型

```ts
interface FeedbackEvent {
  id: string;
  goalId: string;
  runId?: string;
  channel: "qq" | "feishu" | "cli" | "web";
  rawMessage: string;
  parsedIntent:
    | "continue"
    | "deep_dive"
    | "compare"
    | "revise"
    | "pause"
    | "resume"
    | "generate_doc"
    | "create_task";
  actionPayload: unknown;
  createdAt: string;
}
```

### 预期交付

```text
src/mastra/runtime/feedback/
  feedback.schema.ts
  feedback-store.ts
  feedback-parser.ts

src/gateway/qq/
  qq-message-adapter.ts
  qq-push-provider.ts
```

CLI/mock 示例：

```bash
omni goal feedback ai-memory-research "下一步重点分析 mem0 和 letta 的 memory 写入策略"
```

### 验收标准

- 用户反馈可以关联 goal。
- 反馈可以解析成结构化 action。
- Goal 下一次 run 能读取上次反馈。
- 支持 pause / resume / deep_dive / generate_doc。

---

# M4：Memory / Knowledge Platform 增强

## 目标

把 Goal Runtime 的过程数据沉淀为可持续增长的知识系统。

## PR-20：Evidence Store + Dedup / Rank

状态：已完成。

### 目标

为 GitHub / 论文 / 博客 / RSS / 本地仓库资料建立统一证据层。

### 建议模型

```ts
interface EvidenceItem {
  id: string;
  goalId: string;
  sourceType: "github" | "paper" | "blog" | "rss" | "local_repo" | "doc";
  sourceUrl?: string;
  title: string;
  contentHash: string;
  summary?: string;
  relevanceScore?: number;
  noveltyScore?: number;
  qualityScore?: number;
  metadata: unknown;
  createdAt: string;
}
```

### 验收标准

- 同 URL 不重复入库。
- 同 contentHash 不重复入库。
- 能按 relevance / novelty / quality 排序。
- Evidence 可被 artifact 引用。

## PR-21：Goal Capsule

状态：待执行。

### 目标

避免每次长期任务加载全部历史，降低 token 消耗。

### Capsule 内容

```text
goal objective
current stage
known findings
open questions
rejected directions
user preferences
last run summary
next actions
artifact index
```

### 预期交付

```text
src/mastra/runtime/goal/goal-capsule.ts
```

### 验收标准

- 每次 run 前生成 capsule。
- capsule 控制在预算内。
- capsule 引用 artifact/evidence，而不是复制全部内容。

## PR-22：Goal Wiki / Artifact Engine

状态：待执行。

### 目标

把日报、wiki、设计文档、博客、落地计划统一为 Artifact。

### 建议模型

```ts
interface Artifact {
  id: string;
  type:
    | "daily_digest"
    | "wiki"
    | "blog"
    | "gap_analysis"
    | "design_doc"
    | "implementation_plan"
    | "summary";
  ownerType: "goal" | "task" | "user" | "project";
  ownerId: string;
  title: string;
  path: string;
  sourceEvidenceIds: string[];
  version: number;
  status: "draft" | "reviewing" | "approved" | "published";
}
```

### 验收标准

- artifact 有统一 metadata。
- artifact 可引用 evidence。
- artifact 可版本化。
- wiki 更新以 diff 形式生成。
- 正式写入需要用户确认或明确策略。

## PR-23：SQLite Memory Index MVP

状态：待执行。

目标：Markdown Vault + SQLite FTS/BM25，不做向量库优先。

补充验收标准：

- Markdown 文档可索引。
- Artifact 可索引。
- Evidence summary 可索引。
- 支持 keyword / BM25 检索。
- 检索结果带 source path。

## PR-24：Profile Facets MVP

状态：待执行。

目标：用户偏好具备 confidence、source、updated_at。

补充要求：Goal feedback 可以沉淀为偏好 proposal，例如用户更关注本地化方案、token 成本、4+1 设计文档、先 MVP 后扩展等偏好。

## PR-25：Memory Consolidation Report

状态：待执行。

目标：定期整理候选记忆，但不自动污染核心记忆。

补充要求：每周生成新增事实、新增偏好、可沉淀经验、可废弃旧知识、冲突记忆、建议写入项。

---

# M5：OpenHuman-like Core 扩展

M5 不建议马上做，但现在要预留接口。

## PR-26：Connector 四象限模型

状态：已完成。

验证：`npm test -- --run tests/connectors.test.ts` 通过；`npm run typecheck` 通过。

### 目标

每个外部连接器不只是工具，而是可以承担 tool、memory source、trigger source、profile signal 四种角色。

```ts
interface Connector {
  asTool?(): ToolDefinition[];
  asMemorySource?(): MemorySource;
  asTriggerSource?(): TriggerSource;
  asProfileSignal?(): ProfileSignalExtractor;
}
```

第一批 Connector：GitHub、LocalRepo、RSS、arXiv、Blog、QQbot、Feishu、Obsidian / Markdown。

## PR-27：Tool Output Compression Gateway

状态：已完成。

验证：`npm test -- --run tests/context-pack.test.ts` 通过；`npm run typecheck` 通过。

### 目标

从现有 ContextJuice 演进，让所有高 token 工具输出进入 LLM 前先经过压缩网关。

第一批支持：git diff、test log、repo tree、grep / ripgrep、GitHub search result、README、论文 abstract、blog html。

## PR-28：Model Router

状态：已完成。

验证：`npm test -- --run tests/model-router.test.ts` 通过；`npm run typecheck` 通过。

### 目标

根据任务 hint 自动选择模型，并记录 cost / token。

示例 hint：`fast`、`summarize`、`reasoning`、`code`、`long-context`。

## PR-29：Obsidian / Markdown 双向同步

状态：已完成。

验证：`npm test -- --run tests/artifact-engine.test.ts` 通过；`npm run typecheck` 通过。

### 目标

让 Agent 产出的 wiki / memory / design docs 可被用户编辑，并能重新摄取。

验收标准：artifact 可导出 Markdown；frontmatter 带 artifact id / evidence id / version；用户修改后可重新 ingest；冲突不自动覆盖，生成 proposal。

## PR-30：Mobile / QQ / Feishu Notification Channel

状态：待执行。

### 目标

统一主动推送与反馈入口。同一条 Goal digest 可推送到 QQ / 飞书 / CLI mock，反馈事件统一进入 FeedbackEvent。

## PR-31：权限、安全与凭据管理增强

状态：待执行。

### 目标

随着 Connector 增多，补齐本地安全边界。

验收标准：每个 connector 有 scope；每个 tool 有 risk level；危险操作走 Tool Gateway / Approval；凭据不明文落盘；有 audit log；支持 revoke connector；支持 forget / delete memory。

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
当前阶段：M3 Goal Runtime 与长任务工作编排增强
当前优先级：PR-14 Goal WorkspaceManager MVP
上一步完成：PR-13 TestReview MVP
下一步建议：进入 PR-14，先建立 Goal 数据模型、Goal workspace 与路径安全测试
```

## 5.1 两个急迫场景的 MVP 验收路径

### 场景 A：AI 长记忆系统主题研究

创建目标示例：

```bash
omni goal create \
  --type topic_research \
  --title "AI工程长记忆系统研究" \
  --sources "github,arxiv,blogs,rss" \
  --cadence "daily 09:30" \
  --artifacts "daily_digest,wiki,blog,memory_proposal" \
  --feedback "qq"
```

MVP 验收：

```text
第 1 天：
- 搜索并保存 evidence
- 生成 daily-digest.md
- 生成 wiki-diff.md
- mock 推送

第 2 天：
- 能读取第 1 天 capsule
- 去重旧资料
- 根据用户反馈调整搜索方向

第 3-5 天：
- 形成 topic wiki v1
- 形成可落地改进建议
```

### 场景 B：OmniAgent memory 模块改进

创建目标示例：

```bash
omni goal create \
  --type module_improvement \
  --title "OmniAgent Memory模块改进" \
  --scope "src/mastra/runtime/context-pack,docs/knowledge" \
  --sources "local_repo,github,blogs" \
  --artifacts "gap_analysis,design_4plus1,implementation_plan" \
  --feedback "qq"
```

MVP 验收：

```text
第 1 天：
- 搜索候选 GitHub 仓库
- 生成 candidate-repos.json
- 生成 repo-analysis.md

第 2 天：
- 深挖 Top 3 仓库
- 生成 gap-analysis.md

第 3 天：
- 生成 design-4plus1.md
- 生成 implementation-plan.md
- 推送给用户确认

第 4 天：
- 根据反馈修订方案
- 可进入 requirement-e2e / code task 流程
```

## 5.2 架构决策待确认

```text
ADR-001：采用 Workflow-first + Few-Agent + Skill-based 架构
ADR-002：长期任务统一抽象为 Goal，而不是独立定时脚本
ADR-003：当前两个长任务作为 Scenario，不作为架构中心
ADR-004：Memory 分为 Goal Memory 与 User Memory
ADR-005：Artifact 成为一等公民
ADR-006：Feedback 事件化，QQbot 只是第一种 channel
ADR-007：Connector 预留 asTool / asMemorySource / asTriggerSource / asProfileSignal 四象限
ADR-008：先完成 M2 产物链路，再进入 M3 Goal Runtime
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

