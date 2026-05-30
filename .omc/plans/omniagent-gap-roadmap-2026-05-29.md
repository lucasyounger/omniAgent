# OmniAgent 系统目标差距分析与分阶段改进计划

日期：2026-05-29
模式：RALPLAN consensus（Planner/Architect/Critic 外部审查已完成；本版按 Critic `ITERATE` 反馈修订）

## 0. RALPLAN-DR Summary

### Principles

1. **闭环优先**：优先打通 AI R&D E2E 长任务闭环，而不是继续横向堆功能模块。
2. **Mastra-native 优先**：Agent / Tool / Workflow / Scheduler / Storage / Memory 能复用 Mastra 原生能力时优先复用；自研 Runtime 只保留在本地 Personal AI OS 边界和持久协议边界。
3. **AI-readable artifacts 优先**：所有长任务必须产出可追溯、可审查、可再次消费的 artifacts，而不是只把状态留在聊天或日志里。
4. **安全可回滚执行优先**：CodeAgent / PR Pool 的真实写入执行必须优先补齐 workspace、diff、sandbox、rollback、verification、commit 边界。
5. **能力路由收敛优先**：Router 不应直接持有大量业务工具；用户意图应尽量进入 Capability -> Plan -> RuntimeTask -> Dispatcher/Workflow 的统一路径。

### Decision Drivers

1. **尽快接近 North Star**：目标不是“拥有很多 runtime 模块”，而是能稳定完成从目标设定到执行、验证、记忆回流的长任务。
2. **降低未来 AI 修改成本**：模块边界、文档卡片、PR Pool brief、RuntimeTask 事件都必须让未来 CodeAgent 能低 token 理解和修改。
3. **控制执行风险**：当前系统已经接近“会自动产生和执行代码任务”，必须先把安全与可观测性做到可接受，再扩大自治范围。

### Viable Options

#### Option A：先平台契约 / Execution Engine，再接 PR Pool

**做法**：先定义统一 Execution Engine、Capability Contract、Memory Contract，再把 PR Pool/CodeAgent 接入为一个执行后端。

**优点**：
- 平台一致性最高，后续 Router、Scheduler、Memory、Gateway 更容易复用同一套语义。
- 可减少 PR Pool/CodeAgent 先行带来的二次迁移成本。

**缺点**：
- 短期无法证明真实 AI R&D 长任务闭环。
- 容易陷入抽象先行，缺少真实执行数据校验契约设计。
- 当前分支已集中在 PR Pool / CodeAgent execution，若转向大平台契约会拉长收口周期。

#### Option B：先 PR Pool / CodeAgent 闭环，但带最小平台契约护栏（推荐）

**做法**：以 PR Pool / CodeAgent confirmed-run 为第一条真实执行闭环，同时强制 Phase 1 产出 Job / Artifact / Approval / Workspace / Verification / Evidence 六类最小平台契约，使其成为未来 Execution Engine 的第一个 vertical slice。

**优点**：
- 最快获得真实长任务执行证据。
- 能用真实失败、验证、人工接管、上下文复用数据反向校准平台契约。
- 当前分支改动与该方向一致，落地成本最低。

**缺点**：
- Phase 1 会同时承担产品闭环与契约设计，范围控制要求更高。
- 若 DoD 不严格，仍可能滑向 PR Pool/CodeAgent 局部最优。

#### Option C：先 Memory / Router 全局能力，再做执行闭环

**做法**：先升级 Memory Retriever、Capability Router、Execution Planner，让系统具备更强上下文和语义路由，再接真实代码执行。

**优点**：
- 更贴近 Personal AI OS 的长期智能层。
- 可先降低 token 成本和上下文质量问题。

**缺点**：
- 缺少真实执行闭环时，Memory/Router 的需求容易失真。
- 无法尽早验证 CodeAgent 安全、workspace、verification、reconcile 的关键风险。
- 对用户可见价值较慢。

### Recommendation

选择 **Option B：先 PR Pool / CodeAgent 闭环，但带最小平台契约护栏**。原因是它最快获得真实长任务执行证据，同时通过 Phase 1 的硬性契约和 DoD 避免局部最优。PR Pool / CodeAgent 不作为孤立产品线推进，而是作为未来 Execution Engine 的首个垂直切片；Execution Engine、Capability Contract、Memory Contract 先以最小可落地骨架进入主路径，再由真实执行数据驱动扩展。

第一阶段必须固化的最小通用契约：

- **Job**：id、type、status、input contract、owner、createdAt、updatedAt、resume cursor。
- **Artifact**：type、uri/path、schemaVersion、producer job、consumer semantics。
- **Approval**：scope、decision、actor/source、expires/validity、linked artifact。
- **Workspace**：root、allowed paths、branch/worktree policy、dirty-state policy。
- **Verification**：command/test kind、result、evidence ref、required/optional。
- **Evidence**：logs、diffs、summaries、failure categories、human intervention points。

Artifact 分层采用 **compact machine-readable contract + expandable evidence logs**：主路径只携带 refs、schemaVersion、摘要和消费者语义，大 transcript / diff / logs 保存在 evidence artifact 中按需展开。

Phase 1 起即记录最小指标：任务完成率、人工介入点、失败类别、验证通过率、上下文复用率。

---

## 1. 系统目标分层

### 1.1 North Star

根据 `docs/PROJECT_VISION.md:2`，OmniAgent 最高目标是成为本地、基于 Mastra 的 Personal AI Operating System：连接用户数字工作流，积累长期记忆，通过 Semantic Capability Orchestration 完成复杂长任务。

关键优化方向来自 `docs/PROJECT_VISION.md:6`：
- 更低 token 成本；
- 更高上下文密度；
- 更高长任务完成率；
- AI-readable middleware / artifacts；
- durable memory 与 context engineering；
- 尽可能使用 Mastra-native capabilities。

### 1.2 第一产品闭环

`docs/PROJECT_VISION.md:15` 定义第一产品线是 AI R&D E2E 长任务 workflow：

1. 用户设置 Goal；
2. 系统主动探索相关主题和上下文；
3. 生成 AI 执行设计和需求 checklist；
4. 已确认需求归档进入 PR Pool；
5. 系统周期拉取 pending PR Pool requirements；
6. 通过 opencode、Claude Code、Codex 等 coding agents 执行开发；
7. 结果、决策、可复用上下文回流长期记忆和文档。

### 1.3 平台能力目标

现有文档显示平台内核已围绕这些能力形成：

- RuntimeTask / Team Runtime 作为持久任务、运行、事件、inbox、result 协议（`docs/knowledge/TEAM_RUNTIME.md:0`）。
- Task Dispatcher 按 taskType / targetAgentId 路由到 handler（`docs/knowledge/TEAM_RUNTIME.md:12`）。
- Goal Runtime 提供 Goal / GoalRun / artifacts / feedback / PR Pool backlink（`docs/GOAL_RUNTIME.md:0`）。
- PR Pool 作为确认后的代码生成需求池（`docs/knowledge/TEAM_RUNTIME.md:180`）。
- CodeAgent 通过可配置 code executor CLI 执行本地代码任务（`docs/agents/CODE_AGENT.md:4`）。
- Capability Registry / Capability Planner / LLM Router / Execution Engine 正在把自然语言请求收敛到 capability plan 和 RuntimeTask（`docs/knowledge/TEAM_RUNTIME.md:281`、`docs/knowledge/TEAM_RUNTIME.md:297`、`docs/knowledge/TEAM_RUNTIME.md:306`）。
- DomainEvent / projections / streaming 为 CLI/Web/Desktop 客户端提供统一事件视图（`docs/knowledge/TEAM_RUNTIME.md:155`）。
- Channel protocol v2 和 adapter registry 支持多渠道共享核心（`docs/roadmap/OMNI_OVERALL_EXECUTION_REQUIREMENTS.md:73`）。

### 1.4 工程质量目标

`docs/START_HERE.md:31` 和项目 CLAUDE.md 要求行为变更必须同步代码、文档、测试，并通过 verify。当前 `package.json:15` 定义 `npm run verify = typecheck + test + verify:change-sync`。

工程质量目标应包括：
- 每个 PR Pool 切片可独立验证；
- 行为变更强制 docs/tests sync；
- GitNexus impact / detect_changes 进入变更流程；
- lint baseline 补齐；
- artifacts 和 Runtime events 支撑后续审计、调试、回放。

---

## 2. 现状评估

### 2.1 已具备能力

1. **长期目标文档明确**：`docs/PROJECT_VISION.md` 已明确 North Star、第一 E2E workflow、Mastra-native 原则。
2. **RuntimeTask / Team Runtime 基础成熟**：已有 file-backed RuntimeTask store、Team Runtime compatibility、timeline、resultRef、approval linkage、dispatcher lease/concurrency。
3. **Task Dispatcher 已拆出 handler registry**：`docs/knowledge/TEAM_RUNTIME.md:12` 显示 dispatcher control flow 与 handler modules 已开始分离。
4. **Goal Runtime MVP 已具备**：支持 goal create/read/pause/resume、GoalRun、proof-of-work、retry/reconcile、topic research、module improvement、feedback、goal channel integration。
5. **Req Library 已具备需求确认中间层**：`.omni/reqs` 支持文档级和 item 级确认（`docs/REQ_LIBRARY.md:14`）。
6. **PR Pool 已成为确认需求到代码执行的中间层**：ingest / confirm / develop / archive / scan 等 runtime task 已形成。
7. **CodeAgent executor 抽象已扩展**：支持 `claude_code | opencode | codex | custom`，记录 ExecutorRuntime / ExecutorRun / transcripts（`docs/agents/CODE_AGENT.md:30`）。
8. **事件与投影基础具备**：DomainEvent、Goal timeline、PR Pool board、RuntimeTask timeline、approval inbox、streaming API 已存在。
9. **多渠道协议基础具备**：Channel protocol v2、adapter registry、shared capability client/view models 已完成。
10. **变更同步机制具备**：`verify:change-sync` 和文档映射已成为项目规则。

### 2.2 半成品能力

1. **E2E workflow 仍偏 dry-run/shadow**：`docs/roadmap/OMNI_OVERALL_EXECUTION_REQUIREMENTS.md:43` 表明 AI Dev E2E workflow 已覆盖 intake 到 follow-up scheduling，但现有描述仍强调 dry-run/shadow 与 auditable planning records。
2. **Goal -> Req -> PR Pool -> CodeAgent 闭环存在但仍需真实可靠性打磨**：Goal feedback 可携带 confirmed PRPoolProposal，但 `docs/GOAL_RUNTIME.md:4` 仍说明默认只创建 draft，confirm/develop 分离。
3. **MemoryRuntime 与 docs memory 边界清楚，但完整 retriever 未完成**：`docs/GAP.md:39` 明确缺 structured records、hybrid retrieval、confidence、privacy、conflict、expiry、delete workflows。
4. **Router/Capability/Execution Engine 正在收敛，但 legacy path 仍存在**：`docs/GAP.md:18` 指出 OmniRouter 仍有直接 tool access compatibility path。
5. **Dispatcher 已拆，但仍承担大量 runtime surface**：`docs/GAP.md:33` 仍认为 dispatcher 是 growing god module；`docs/knowledge/TEAM_RUNTIME.md:174` 列出的 handler 类型很多。
6. **CodeAgent 已能执行，但安全边界仍演进**：`docs/GAP.md:45` 列出 sandbox、diff review、command/network policy、rollback strategy 等缺口。
7. **Scheduler 可用但 process-local**：`docs/GAP.md:56` 指出缺 misfire policy、concurrency controls、observability。
8. **Gateway 本地协议强于真实外部验证**：`docs/GAP.md:60` 指出真实 QQ/平台回调依赖凭据和外部事件验证。

### 2.3 缺失能力

1. **一条被持续验证的 production-like AI R&D E2E golden path**。
2. **CodeAgent patch-first / sandbox-first / rollback-first 的默认执行模式**。
3. **Memory Retriever / Memory Writeback 的冲突、隐私、删除、过期闭环**。
4. **统一 observability：Goal / Req / PR Pool / RuntimeTask / CodeTask / ExecutorRun / Artifact 的跨对象 trace view**。
5. **基于真实长任务的 eval harness 与回归数据集**。
6. **Scheduler daemon 化与跨重启 misfire 策略**。
7. **多渠道真实验证矩阵与凭据隔离运行手册**。
8. **lint baseline 与更细粒度质量门禁**。

---

## 3. 差距优先级

| 优先级 | 差距 | 用户价值 | 架构风险 | 落地成本 | 依赖 |
|---|---|---:|---:|---:|---|
| P0 | PR Pool -> CodeAgent -> verify -> reconcile -> memory/docs 回流 golden path 不够硬 | 极高 | 高 | 中 | 当前分支 PR Pool/CodeAgent 改动 |
| P0 | CodeAgent sandbox/diff/rollback/command policy 不够强 | 高 | 极高 | 中高 | workspace manager、ExecutorRun、Tool Gateway |
| P0 | E2E artifacts trace 不够统一 | 高 | 高 | 中 | DomainEvent、Artifact Store、GoalRun、PR Pool evidence |
| P1 | Router 直接工具过多，Capability/RuntimeTask 未完全成为主路径 | 中高 | 高 | 中 | Tool registry、Capability Router、Execution Engine |
| P1 | Dispatcher handler surface 继续膨胀 | 中 | 高 | 中 | handler registry、tests |
| P1 | MemoryRuntime 不是完整 Memory Service / Retriever | 高 | 中 | 高 | memory-index、consolidation、profile、policy |
| P2 | Scheduler process-local | 中 | 中 | 中 | runtime storage、DomainEvent、daemon process |
| P2 | Gateway 外部真实渠道验证不足 | 中高 | 中 | 中高 | credentials、adapter registry、delivery worker |
| P2 | Eval Harness 未进入闭环质量门禁 | 高 | 中 | 中 | eval-harness、golden path fixtures |
| P3 | UI/Dashboard 产品化不足 | 中 | 低中 | 中 | projections、streaming API |
| P3 | LibSQL migration 未完成 | 中 | 中 | 高 | storage adapters、migration scripts |

---

## 3.5 平台契约骨架与阶段风险表

### 3.5.1 Phase 1 必须前置的平台契约骨架

Phase 1 不是单纯硬化 PR Pool / CodeAgent，而是定义未来 Execution Engine v1 的最小骨架。所有首批切片必须能落到以下通用对象，避免后续 Router、Capability、Scheduler、Memory 各自形成一套状态语义。

| 契约 | 最小字段 | Phase 1 用途 | 后续提升方向 |
|---|---|---|---|
| Job | id / type / status / inputContract / owner / createdAt / updatedAt / resumeCursor | 将 confirmed PR Pool item 映射成 compact execution job view | Execution Engine、Scheduler daemon、CapabilityPlan 共用 job model |
| Artifact | type / uri 或 path / schemaVersion / producerJob / consumerSemantics | 引用 proposal、brief、diff、verification、review、final summary，主路径只携带 compact refs | Dashboard、MemoryRuntime、Eval harness 按需展开 evidence logs |
| Approval | scope / decision / actor 或 source / expires 或 validity / linkedArtifact | 表达用户确认、Tool Gateway approval、人工接管点 | 跨 channel approval、paused workflow resume |
| Workspace | root / allowedPaths / branch 或 worktree policy / dirtyStatePolicy | 限制 CodeAgent 可写范围和失败保留策略 | policy-center、sandbox、rollback manager |
| Verification | command 或 test kind / result / evidenceRef / required 或 optional | 记录 typecheck/test/change-sync/GitNexus 证据 | eval harness、quality gates、release readiness |
| Evidence | logs / diffs / summaries / failureCategories / humanInterventionPoints | completed/failed/blocked 都可结构化复盘 | Memory writeback、observability、long-task metrics |

Artifact 分层原则：**compact machine-readable contract + expandable evidence logs**。RuntimeTask / PR Pool / CapabilityPlan 的主路径只保存 schemaVersion、refs、摘要和消费者语义；大 transcript、diff、logs、review details 作为 evidence artifact 按需读取。

### 3.5.2 阶段风险表

| 风险 | 触发条件 | 影响 | 缓解措施 | 监测信号 |
|---|---|---|---|---|
| PR Pool/CodeAgent 孤岛化 | Phase 1 只修执行特例，不产出 Job/Evidence 契约 | Phase 3 平台收敛需要二次迁移 | PR-1.0 必须先落地 execution job view 和 evidence schema | 新字段只能被 PR Pool 使用，无法被 Scheduler/Execution Engine 解释 |
| 抽象先行拖慢闭环 | PR-1.0 试图一次重写 Execution Engine | golden path 无法按期验证 | 契约先做 projection/read model，不重写全部路径 | contract PR 影响过多 handler/runtime |
| 安全边界文档化而非运行时化 | CodeAgent brief 写了规则，但 runtime 不验证 workspace/policy | direct execution 风险不可控 | Phase 2 将 workspace/approval/network/write scope 固化为 execution policy | failed run 缺 blocker 分类或 policy refs |
| 已确认切片被误扩权执行 | confirmed PR Pool no-repeat-approval 被误解为无限自动执行 | 产生未授权写入、网络访问或越界工具调用 | Phase 1 区分 approval scope 与 execution policy scope；confirmed 只免重复计划审批，不免 workspace/network/write/tool gate | confirmed run 缺 linked approval artifact、policy refs 或 forbidden path evidence |
| Memory 后置导致无源回流 | 执行结果只留 transcript 或聊天摘要 | 后续 MemoryRuntime 无法可靠提取经验 | Phase 1 必须保存 evidence artifact 和 memory candidate refs | completed item 没有 reusable decision/doc candidate |
| Memory 污染 | completed/failed 执行摘要未经治理直接进入长期记忆 | 错误事实、临时决策或失败噪音污染后续 context pack | Phase 1 只产出 governed memory candidate refs；Phase 5 再做 approval/conflict/privacy/expiry/delete | accepted memory 缺 source evidence、confidence、scope 或 status |
| Scheduler 状态机分裂 | daemon 后续独立定义 schedule job 语义 | 长任务和定时任务无法统一观测/恢复 | Scheduler job model 对齐 Job/Evidence/Verification | schedule run 无 correlationId/jobRef/evidenceRef |
| 指标过晚补齐 | eval/UI 阶段才开始定义 completion metrics | 无法判断阶段改动是否改善完成率 | Phase 1 起记录最小指标 | golden path fixture 无 completion/failure/intervention 数据 |

---

## 4. 分阶段改进计划

### Phase 0：冻结目标与当前分支收口

**目标**：先把当前 PR Pool / CodeAgent execution 相关改动收口，避免在不稳定基础上继续规划新路线。

**建议切片**：

#### PR-0.1 当前分支一致性验证

- 范围：当前已修改文件，包括：
  - `src/mastra/lib/code-task-store.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-store.ts`
  - `src/mastra/runtime/task-dispatcher/handlers/code-handler.ts`
  - `src/mastra/tools/pr-pool-tools.ts`
  - `tests/code-task-store.test.ts`
  - `tests/pr-pool-runtime.test.ts`
  - `tests/task-dispatcher.test.ts`
  - 相关 docs/skills。
- 验收：
  - `npm run typecheck` 通过。
  - 相关测试通过：`tests/code-task-store.test.ts`、`tests/pr-pool-runtime.test.ts`、`tests/task-dispatcher.test.ts`。
  - `npm run verify:change-sync` 通过。
  - GitNexus detect_changes 显示影响范围与 PR Pool/CodeAgent execution 一致。
- 风险：当前未提交变更多，若继续叠加新改动会增加回归定位成本。

#### PR-0.2 文档目标对齐

- 范围：更新 `docs/PROJECT_VISION.md`、`docs/GAP.md`、`docs/roadmap/OMNI_OVERALL_EXECUTION_REQUIREMENTS.md`，把“已完成 checkbox”与“仍需硬化”的状态分开。
- 验收：
  - `docs/GAP.md` 不再只列模块缺口，还列 E2E golden path 缺口。
  - `docs/PROJECT_VISION.md` 明确接下来 3 个 milestone。
  - 不修改 src 时可只跑 docs 相关检查；若触发 sync guard，则按项目规则补齐测试或说明。

---

### Phase 1：AI Dev E2E confirmed-run MVP + Execution Engine vertical slice

**目标**：形成一条可重复演示、可回归测试、可生成 artifacts 的 confirmed-run 主路径：Goal -> Req -> PR Pool -> CodeAgent -> verify -> reconcile -> memory/docs。该主路径同时是未来 Execution Engine v1 的首个垂直切片，Phase 1 的第一交付物必须是 Job / Artifact / Approval / Workspace / Verification / Evidence 六类契约骨架，而不是先继续堆 PR Pool/CodeAgent 特例。

**Phase 1 非目标**：

- 不重写完整 Execution Engine。
- 不引入复杂向量 MemoryRuntime。
- 不做真实多渠道 daemon 化。
- 不默认扩大 CodeAgent direct execution 范围。

**架构护栏**：

- PR Pool item 必须能映射到未来 Execution Engine job model，不能只服务代码生成特例。
- CodeAgent 安全边界必须从 Phase 1 起具备最小 runtime policy gate：workspace scope、approval scope、network/tool scope、write scope、ordered execution scope；Phase 2 再做 hardened policy。
- MemoryRuntime 可以后置升级，但 evidence capture 不能后置；所有执行结果、失败原因、人工决策必须先进入结构化 evidence artifact。
- Scheduler 后续 job model 必须对齐同一套 Job / Evidence / Verification 语义，避免“定时任务”和“长任务执行”两套状态机。
- Phase 1 起记录最小观测指标：completion rate、human intervention points、failure categories、verification pass rate、context reuse rate。

#### PR-1.0 Execution Contract Skeleton

- 文件/模块：
  - `src/mastra/runtime/execution-engine.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-store.ts`
  - `src/mastra/runtime/artifacts/`
  - `docs/knowledge/TEAM_RUNTIME.md`
  - `tests/pr-pool-runtime.test.ts` 或新增 execution contract tests
- 内容：
  - 定义最小通用契约字段：Job、Artifact、Approval、Workspace、Verification、Evidence。
  - 将 PR Pool ready item 映射为 execution job view，先作为 read/model projection，不强行重写全部执行路径。
  - evidence artifact 必须支持：执行摘要、失败分类、人工介入点、验证结果、memory candidate refs。
  - 契约字段必须保留 Scheduler/CapabilityPlan 可解释的来源、状态、恢复、artifact refs，而非 PR Pool 专用命名。
- 验收：
  - 单个 PR Pool item 可生成 compact execution job view。
  - evidence artifact schema 能覆盖 completed、failed、blocked 三类结果。
  - 不复制大 transcript，只保存 refs 和结构化摘要。
  - contract tests 证明 job/evidence view 不依赖 PR Pool 私有路径即可被读取。
  - contract serialization unit tests、artifact schema snapshot tests 通过。

#### PR-1.1 AI Dev E2E WorkflowRun Persistence

- 文件/模块：
  - `tests/ai-dev-e2e-workflow.test.ts` 或新增 golden path 测试文件；
  - `src/mastra/runtime/task-runtime.ts`；
  - `src/mastra/runtime/runtime-task-store.ts`；
  - `src/mastra/runtime/events/` 或现有 DomainEvent store；
  - `docs/knowledge/TEAM_RUNTIME.md`。
- 内容：
  - 定义一个最小 module_improvement Goal fixture。
  - 固化 WorkflowRun / RuntimeTask / resultRef / DomainEvent / resume cursor 的串联方式。
  - 每一步状态转移必须能通过持久化 timeline 或 resultRef 复盘。
  - fixture 输出 Phase 1 最小指标：completion、failureCategory、humanIntervention、verificationStatus、contextReuseRefs。
- 验收：
  - 测试断言每一步都有 RuntimeTask id、resultRef、DomainEvent 或 timeline entry。
  - 测试断言 resume cursor 可定位到最后一个成功步骤或明确失败步骤。
  - completed 与 verification failed 两类路径都能从持久化状态复盘。

#### PR-1.2 Confirmed PR Pool Mode

- 文件/模块：
  - `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-store.ts`
  - `src/mastra/tools/pr-pool-tools.ts`
  - `tests/pr-pool-runtime.test.ts`
- 内容：
  - confirmed PR Pool item 创建 Execution Job / WorkflowRun。
  - draft、generated、ambiguous item 不自动执行，只保留 review-ready proposal。
  - confirmation 来源、linked approval artifact、idempotency key 必须进入 compact contract refs。
- 验收：
  - confirmed item 进入 ready/developable 路径并生成 job view。
  - draft/generated item 不会创建 CodeAgent child RuntimeTask。
  - 重复 ingest 同一 idempotencyKey 不产生重复 job。

#### PR-1.3 Confirmed-run Dispatch

- 文件/模块：
  - `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`
  - `src/mastra/runtime/task-dispatcher/handlers/code-handler.ts`
  - `tests/pr-pool-runtime.test.ts`
  - `tests/task-dispatcher.test.ts`
- 内容：
  - PR Pool develop 创建并 dispatch CodeAgent child RuntimeTask。
  - child task metadata 只保存 compact refs，不复制完整 proposal/brief/transcript。
  - failed/blocked 路径记录 failure category、human intervention point、resume cursor 或明确不可恢复原因。
- 验收：
  - confirmed run happy path integration test 通过。
  - failure path tests 覆盖 policy boundary failed、missing credential / external blocker。
  - Re-run/reconcile 可从持久化状态恢复，或产出明确 unrecoverable evidence。

#### PR-1.4 Diff / Evidence Artifact

- 文件/模块：
  - `src/mastra/runtime/artifacts/`
  - `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-store.ts`
  - `src/mastra/lib/code-task-store.ts`
  - `docs/templates/pr-pool-proposal.md`
  - `tests/code-task-store.test.ts`
  - `tests/pr-pool-runtime.test.ts`
- 内容：
  - CodeAgent 在受限 workspace 中产出 diff artifact、logs refs、summary refs。
  - 为每个 PR item 定义 evidence bundle：brief、proposal、execution transcript refs、diff refs、verification refs、docs/tests sync refs、GitNexus refs、final summary。
  - 主路径只携带 compact refs、schemaVersion、producer job、consumer semantics。
- 验收：
  - ready -> develop -> completed 生成完整 bundle。
  - failed item 包含 blocker 分类：approval/permission/high-impact/test-failure/external/missing-credential/impossible。
  - artifact schema snapshot tests 证明 completed、failed、blocked 三类 evidence 均可序列化。

#### PR-1.5 Verification Evidence

- 文件/模块：
  - `src/mastra/runtime/task-dispatcher/handlers/code-handler.ts`
  - `src/mastra/lib/code-task-store.ts`
  - `docs/agents/CODE_AGENT.md`
  - `docs/knowledge/CLAUDE_CODE.md`
  - `tests/code-task-store.test.ts`
  - `tests/task-dispatcher.test.ts`
- 内容：
  - CodeAgent brief 必须包含：objective、editable paths、forbidden paths、verification plan、docs/tests sync requirements、GitNexus impact requirement、commit policy、stop conditions。
  - typecheck/test/change-sync/GitNexus evidence 关联到 job、RuntimeTask resultRef 与 PR Pool item。
  - 对 PR Pool confirmed slice：明确“不再二次计划审批”，但 HIGH/CRITICAL impact、缺凭据、验证失败必须停止。
  - executor args defaults 与 explicit args 行为测试固定。
- 验收：
  - brief snapshot 测试覆盖所有关键字段。
  - verification evidence 与 job/artifact refs 可从 RuntimeTask resultRef 或 PR Pool evidence bundle 追溯。
  - policy 越界 tests 证明 forbidden path / missing workspace policy 不会被标记 completed。

#### PR-1.6 Reconcile + Memory/Docs Candidate Refs

- 文件/模块：
  - `src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts`
  - `src/mastra/runtime/memory*` 或现有 memory writeback workflow；
  - `docs/knowledge/TEAM_RUNTIME.md`
  - `tests/pr-pool-runtime.test.ts`
- 内容：
  - completed PR item 提取 reusable decision / doc update candidate。
  - 写入 memory candidate refs，而不是自动污染长期记忆。
  - rejected/failed item 写入 failure lesson candidate 和 follow-up proposal ref。
- 验收：
  - completed item 有 memory proposal ref。
  - rejected/failed item 不写入 accepted memory，只写入 failure lesson candidate。
  - generated candidate 带 source evidence refs、confidence、scope、status。

---

### Phase 2：执行安全与可回滚能力

**目标**：在 Phase 1 最小 runtime policy gate 基础上，让 CodeAgent 从“能执行”升级为“默认可审查、可限制、可回滚”。

#### PR-2.1 Patch-first Execution Mode 默认化

- 文件/模块：
  - `src/mastra/lib/code-task-store.ts`
  - `src/mastra/runtime/pr-pool/pr-pool-runtime.ts`
  - `src/mastra/runtime/task-dispatcher/handlers/code-handler.ts`
  - `docs/agents/CODE_AGENT.md`
  - `tests/code-task-store.test.ts`
- 内容：
  - 对未 confirmed 或远程 channel 来源任务默认 `patch_proposal`。
  - confirmed PR Pool slice 才允许 direct execution。
  - direct execution 必须记录 workspace policy 和 rollback hints。
- 验收：
  - 不同来源/confirmation 状态映射到正确 executionMode。
  - direct execution 缺 workspace policy 时失败。

#### PR-2.2 Diff Review Artifact

- 文件/模块：
  - `src/mastra/runtime/artifacts/`
  - `src/mastra/lib/code-task-store.ts`
  - `docs/knowledge/CLAUDE_CODE.md`
  - `tests/code-task-store.test.ts`
- 内容：
  - ExecutorRun 完成后记录 changed files、diff summary、verification summary。
  - 如果 workspace 是 managed worktree，归档 diff artifact。
- 验收：
  - mock executor run 可生成 diff artifact。
  - PR Pool evidence bundle 能引用 diff artifact。

#### PR-2.3 Command / Network Policy Skeleton

- 文件/模块：
  - `src/mastra/runtime/policy-center/`
  - `src/mastra/runtime/tool-gateway.ts`
  - `src/mastra/lib/code-task-store.ts`
  - `docs/knowledge/TOOLS.md`
  - `tests/tool-gateway.test.ts`
- 内容：
  - 定义 executor policy metadata：allowed commands、network allowed/blocked、dangerous commands。
  - 先做 audit + blocker 分类，不做复杂 sandbox。
- 验收：
  - denied command 被标记 failed/blocker，而不是 completed。
  - policy 信息进入 CodeAgent brief。

#### PR-2.4 Rollback Strategy MVP

- 文件/模块：
  - workspace manager / PR Pool workspace preparation 相关模块；
  - `docs/agents/CODE_AGENT.md`
  - `tests/pr-pool-runtime.test.ts`
- 内容：
  - managed worktree：失败默认保留或按 policy 清理。
  - direct workspace：要求 commit boundary 或 patch artifact。
  - archive 时记录 cleanup decision。
- 验收：
  - delete_on_archive 只在 archive 后删除 managed worktree。
  - failure 状态保留 debug refs。

---

### Phase 3：Router / Capability / Execution Engine 收敛

**目标**：让 OmniRouter 从“工具大户”变成用户面 coordinator；所有高风险业务 work 进入 CapabilityPlan/RuntimeTask。

#### PR-3.1 Router Tool Exposure Audit

- 文件/模块：
  - `src/mastra/tools/tool-registry.ts`
  - `src/mastra/agents/omni-router-agent.ts`
  - `docs/agents/OMNI_ROUTER_AGENT.md`
  - architecture tests
- 内容：
  - 明确 public facades、read/status tools、internal tools。
  - 禁止 Router 直接拥有低层 mutation tools。
- 验收：
  - 测试防止 RuntimeTask/TeamTask low-level mutation tools 暴露给 Router。
  - docs 列出 Router 可用工具类别。

#### PR-3.2 Capability Planner 多步计划扩展

- 文件/模块：
  - `src/mastra/runtime/capability-planner.ts`
  - `src/mastra/runtime/execution-engine.ts`
  - `tests/*capability*` 或新增测试
- 内容：
  - 支持 Goal -> Req -> PR Pool -> notify 的 deterministic plan。
  - 支持失败步骤输出 failed step id / task id / reason。
- 验收：
  - serial/mixed plan 测试覆盖依赖顺序。
  - direct RuntimeTask 行为不回归。

#### PR-3.3 Execution Engine 成为多步工作统一入口

- 文件/模块：
  - `src/mastra/runtime/execution-engine.ts`
  - `src/mastra/workflows/task-orchestration-workflow.ts`
  - `docs/knowledge/TEAM_RUNTIME.md`
- 内容：
  - 单任务仍可走 dispatcher。
  - 多步 CapabilityPlan / ExecutionPlan 统一持久 Workflow Run。
  - paused 表示 approval/user-confirmation boundary。
- 验收：
  - approval boundary 下 workflow run = paused。
  - resume 后继续后续步骤。

---

### Phase 4：Dispatcher 去神模块化

**目标**：将 dispatcher 从“所有业务处理入口”收敛成薄调度内核 + handler registry + handler contracts。

#### PR-4.1 Handler Contract 文档与测试

- 文件/模块：
  - `src/mastra/runtime/task-dispatcher/handler-registry.ts`
  - `src/mastra/runtime/task-dispatcher/handlers/*`
  - `docs/agents/TASK_AGENT.md`
  - `tests/task-dispatcher.test.ts`
- 内容：
  - 统一 handler 输入输出：task、payload、run context、result writer、event writer。
  - handler 不直接写 runtime status metadata。
- 验收：
  - contract tests 覆盖每个 handler 注册。
  - unsupported/nonexecutable handler fail fast。

#### PR-4.2 Handler 按 runtime surface 拆分完成

- 文件/模块：
  - `handlers/code-handler.ts`
  - `handlers/pr-pool-handler.ts`
  - `handlers/goal-handler.ts`
  - `handlers/req-handler.ts`
  - `handlers/notify-handler.ts`
  - `handlers/schedule-handler.ts`
  - `handlers/research-handler.ts`
- 内容：
  - 每类 handler 文件只依赖自己的 runtime service。
  - dispatcher core 只负责 lease/concurrency/lifecycle/result wrapping。
- 验收：
  - dispatcher core 行数和依赖数下降。
  - 每个 handler 单测可独立 mock runtime service。

---

### Phase 5：Memory Service / Retriever

**目标**：将 file-backed docs memory 升级为可检索、可冲突检测、可隐私控制、可删除/过期的长期记忆服务，同时保持 docs 可审查。

#### PR-5.1 MemoryRecord 与 Docs Memory 边界固化

- 文件/模块：
  - `src/mastra/runtime/memory-index/`
  - `src/mastra/runtime/memory-consolidation/`
  - `docs/agents/KNOWLEDGE_AGENT.md`
  - `docs/knowledge/TEAM_RUNTIME.md`
- 内容：
  - 明确 Mastra Memory = conversation continuity。
  - Docs memory = auditable long-term knowledge/proposals。
  - MemoryRecord = structured retrievable facts with source/confidence/status/expiry。
- 验收：
  - 不同 memory source 不混写。
  - list/search/update/delete/supersede 行为测试覆盖。

#### PR-5.2 Hybrid Retrieval MVP

- 文件/模块：
  - `src/mastra/runtime/memory-index/memory-index.ts`
  - `src/mastra/runtime/context-pack/`
  - tests
- 内容：
  - keyword + metadata filter + scope recall。
  - 先不引入重型向量数据库；保留 embedding adapter boundary。
- 验收：
  - goal-scoped、repo-scoped、user-profile-scoped 检索结果可解释。
  - context pack token budget 包含 memory blocks。

#### PR-5.3 Conflict / Privacy / Deletion Workflow

- 文件/模块：
  - `src/mastra/runtime/memory-consolidation/`
  - `src/mastra/runtime/policy-center/`
  - `docs/skills/memory-maintenance.md`
- 内容：
  - 冲突检测：同一 scope/type 的 contradictory facts 进入 proposal。
  - 隐私策略：PII/secret 不写入长期记忆。
  - 删除/过期：status 与 tombstone event。
- 验收：
  - secret-like input 被拒绝或 redacted。
  - supersede/delete 后 retrieval 不返回 active fact。

---

### Phase 6：Scheduler Daemon 与 Observability

**目标**：让长期任务触发从 process-local 变成可恢复、可观测、可治理。

#### PR-6.1 Misfire Policy 与 Concurrency Controls

- 文件/模块：
  - `src/mastra/runtime/scheduler-runtime.ts`
  - `docs/agents/CRON_AGENT.md`
  - `tests/cron-store.test.ts` 或 scheduler tests
- 内容：
  - 定义 missed schedule 处理：skip / run_once / catch_up_limited。
  - 同一 goal/prpool scan 并发互斥。
- 验收：
  - 重启后不会重复发起同一日 goal scan。
  - misfire policy 可测试。

#### PR-6.2 Runtime Dashboard Trace View

- 文件/模块：
  - `src/mastra/runtime/dashboard/`
  - Gateway `/runtime/dashboard`
  - Domain projections
- 内容：
  - 以 correlationId 串起 Goal、Req、PR Pool、RuntimeTask、CodeTask、ExecutorRun、Artifact。
  - 输出 compact JSON view 给 CLI/Web/Desktop。
- 验收：
  - golden path fixture 可从 dashboard 查到完整 trace。

---

### Phase 7：真实多渠道验证

**目标**：证明 OmniAgent 可通过真实用户渠道承接 goal/task/approval/status，而不是只在本地 HTTP mock 中成立。

#### PR-7.1 Channel Validation Matrix

- 文件/模块：
  - `docs/channels/README.md`
  - `docs/channels/QQBOT.md`
  - `docs/channels/FEISHU.md`
  - `docs/channels/HTTP.md`
- 内容：
  - 区分 implemented / locally validated / externally validated。
  - 列出凭据、回调、事件、出站投递、失败重试验证项。
- 验收：
  - 每个 adapter 都有状态矩阵。

#### PR-7.2 Approval / Status / Digest 通道闭环

- 文件/模块：
  - Gateway handler / delivery / channel protocol v2 adapter
  - `tests/gateway-*`
- 内容：
  - 用户可从通道查看 pending approvals、PR Pool board、Goal status。
  - 通道回复只显示 compact view，详情以 artifact refs 展示。
- 验收：
  - HTTP channel E2E 测试覆盖 create goal -> status -> approval prompt -> notify result。

---

### Phase 8：Eval Harness 与质量门禁产品化

**目标**：把“系统越来越接近目标”变成可度量，而不是靠主观感觉。

#### PR-8.1 Golden Scenario Dataset

- 文件/模块：
  - `src/mastra/runtime/eval-harness/`
  - `docs/TESTING.md`
- 内容：
  - 场景：module improvement、topic research、PR Pool code slice、memory writeback、channel task。
  - 每个场景有 expected artifacts、events、status transitions、verification requirements。
- 验收：
  - eval 可在 mock provider 下稳定运行。

#### PR-8.2 Long-task Completion Metrics

- 指标：
  - goal_to_req_success_rate
  - req_to_prpool_success_rate
  - prpool_to_verified_commit_success_rate
  - memory_writeback_acceptance_rate
  - blocked_reason_distribution
  - average_context_pack_tokens
  - artifact_completeness_score
- 验收：
  - dashboard / eval 输出这些指标。
  - 每次改动可观察是否改善或退化。

---

### Phase 9：存储迁移与产品化 UI

**目标**：当协议稳定后，将 file-backed runtime 逐步迁移到 LibSQL/Storage adapter，并提供轻量本地 UI。

#### PR-9.1 Storage Adapter Compatibility Layer

- 范围：Team Runtime、RuntimeTask、PR Pool、Goal、Req、Scheduler、Gateway delivery。
- 原则：先 adapter，后 migration；保留 file-readable debug export。
- 验收：
  - 同一 contract test 可跑 file backend 与 libsql backend。

#### PR-9.2 Local Dashboard UI

- 范围：读取 shared streaming API / projections。
- 页面：Goal timeline、PR Pool board、Approval inbox、Executor runs、Artifacts。
- 验收：
  - 不引入业务写逻辑；所有 mutation 仍通过 RuntimeTask facade。

---

## 5. Architect Review（内联）

### 最强反方观点

该计划仍然可能太“平台工程化”。如果真正目标是 Personal AI OS，用户首先感知的是“我交给它一个目标，它能持续推进并主动汇报”。过多强调 PR Pool、dispatcher、memory service、storage adapter，可能让系统在工程上更完备，但在产品上仍然没有一个高频、可感知、可信任的助手体验。

### 真实权衡张力

- **闭环速度 vs 执行安全**：越早让 CodeAgent direct execution，越容易证明价值；但越早自治写代码，越需要 sandbox、rollback、approval、diff review。
- **Mastra-native vs 自研 runtime 协议**：Mastra 原生 Workflow/Scheduler/Memory 可减少维护成本；但本地 Personal AI OS 需要跨 CLI、通道、工作区、长期 artifacts 的 durable protocol，自研边界难以完全消除。
- **文档可读性 vs 事件/存储规范化**：docs/markdown 对 AI 友好；结构化 store 对查询、UI、eval 友好。两者必须共存，不能互相替代。

### 综合方案

保持 Option B 的闭环优先 + 平台契约护栏，但每个闭环阶段都绑定一个架构收敛目标：
- Phase 1 硬化 golden path，同时标准化 Job / Artifact / Approval / Workspace / Verification / Evidence 契约和 evidence bundle。
- Phase 2 提升执行安全，并把 workspace、approval、network/tool、write、ordered execution scope 固化为 execution policy。
- Phase 3 收敛 Capability/Execution Engine，再继续扩展自然语言入口。
- Phase 5 之后再做完整 Memory Service，避免在闭环未稳定时过早构建复杂检索。

### 原则违背风险

- 若 Phase 1/2 继续增加 PR Pool/CodeAgent 特例，会违背 Mastra-native 与 RuntimeTask 统一路径原则。
- 若 Memory Service 过早引入向量/复杂检索，会提高 token 和维护成本，违背低 token、高上下文密度原则。
- 若 Gateway 先行扩展真实渠道，会把未稳定执行闭环暴露给用户，降低长任务完成率信任。

---

## 6. Critic Review（内联）

### Verdict

Critic verdict was **ITERATE**. This revision applies the required changes and marks the plan **READY FOR PR POOL INGEST after scoped verification**; it should not be treated as independently re-approved until a follow-up review confirms the applied changes.

### 检查结果

- **Principle-option consistency**：推荐项已修正为 Option B：先 PR Pool / CodeAgent 闭环，但带最小平台契约护栏；与闭环优先、Mastra-native、AI-readable artifacts、durable memory 一致。
- **Alternatives fairness**：Option A/B/C 均有合理优缺点，未被 strawman 化；Architect 的最强反方已纳入 ADR consequences、风险表和 Phase 1 contract skeleton。
- **Driver contradictions**：原计划存在“先闭环”与“平台一致性”张力；已通过前置 Job / Artifact / Approval / Workspace / Verification / Evidence 最小契约缓解。
- **Risk mitigation clarity**：已新增阶段风险表，将主要风险映射到 Phase 1 evidence capture、Phase 2 execution policy、Phase 3 capability convergence、Phase 4 dispatcher modularization、Phase 5 governed memory。
- **Testable acceptance criteria**：每个 PR 切片包含具体测试/文档/状态断言；PR-1.0 明确用 contract/schema/projection tests 锁住平台骨架。
- **Verification concreteness**：包含 typecheck、targeted vitest、verify:change-sync、GitNexus detect_changes、artifact existence checks；Phase 1 起新增 completion rate、human intervention points、failure categories、verification pass rate、context reuse rate 指标。

### 已应用的 ITERATE 改进项

1. 将 Phase 1 明确为未来 Execution Engine v1 的首个垂直切片，而不是 PR Pool/CodeAgent 孤立硬化。
2. 在 Phase 1 前置最小平台契约骨架：Job、Artifact、Approval、Workspace、Verification、Evidence，并新增 3.5 契约表。
3. 将 CodeAgent 安全边界抽象为 execution policy：workspace scope、approval scope、network/tool scope、write scope、ordered execution scope。
4. MemoryRuntime 可后置，但 evidence capture 不可后置；执行结果、失败原因、人工决策必须先结构化保存。
5. Scheduler 后续 job model 必须与 Execution Engine job/evidence/verification 语义对齐。
6. Phase 1 起记录最小观测指标，不能等到最后 UI/eval 阶段才补。
7. 补充阶段风险表，明确每个架构风险的触发条件、影响、缓解措施和监测信号。

### 仍需后续 PR 验证的事项

1. PR-1.0 是否真的只做 contract projection，而不是借机重写 Execution Engine。
2. PR-1.1 WorkflowRun persistence fixture 是否能在 mock executor 下稳定复现 completed/failed 两类路径。
3. PR-1.2 confirmed mode 是否严格阻止 draft/generated/ambiguous item 自动执行。
4. PR-1.5 verification evidence 是否能完整追溯 typecheck/test/change-sync/GitNexus 结果。
5. Phase 2 execution policy 是否成为 runtime 可验证对象，而不是只写进 brief/docs。
6. Memory candidate refs 是否足够支撑后续 MemoryRuntime 检索/写回/冲突处理。

---

## 7. 通用验收与验证策略

每个行为变更 PR 必须：

1. 按项目规则先做 GitNexus impact analysis，再编辑符号。
2. `src/**` 改动必须同步 `docs/**` 和 `tests/**`。
3. 优先跑 scoped tests：对应 `tests/*.test.ts`。
4. 跑 `npm run typecheck`。
5. 跑 `npm run verify:change-sync`。
6. 重要阶段跑 `npm run verify`。
7. 提交前跑 GitNexus detect_changes，确认影响符号/flow 与预期一致。
8. 若改动 PR Pool/CodeAgent/RuntimeTask：必须检查 artifacts、events、resultRef、status transition。

---

## 8. ADR

### Decision

采用 **Option B：先 PR Pool / CodeAgent 闭环，但带最小平台契约护栏**。先稳定 AI R&D E2E golden path，并把 PR Pool / CodeAgent 作为未来 Execution Engine 的首个垂直切片；同时前置 Job / Artifact / Approval / Workspace / Verification / Evidence 契约、execution policy 和 evidence capture，再逐步强化执行安全、Router/Capability/Execution Engine 收敛、Dispatcher 模块化、Memory Service、Scheduler/Gateway、Eval/UI/Storage。

### Drivers

1. OmniAgent 的 North Star 需要真实长任务闭环证明，而不是单点模块完成度。
2. 当前已实现基础模块很多，最大风险是主路径不够稳定、执行安全不够强、artifacts 不够统一。
3. 当前分支正在推进 PR Pool / CodeAgent execution，最适合先收口为可验证闭环。

### Alternatives considered

1. **先平台契约 / Execution Engine，再接 PR Pool**：平台一致性最高，但短期无法证明真实 AI R&D 长任务闭环，且容易抽象先行。
2. **先 PR Pool / CodeAgent 闭环，但带最小平台契约护栏**：最快获得真实执行证据，同时用 Job / Artifact / Approval / Workspace / Verification / Evidence 防止局部最优；这是本 ADR 选择。
3. **先 Memory / Router 全局能力，再做执行闭环**：更贴近 Personal AI OS 智能层，但缺少真实执行闭环时，Memory/Router 的需求和质量指标容易失真。

### Why chosen

闭环硬化优先能最短路径验证“用户设目标 -> 系统产出可执行需求 -> 自动开发 -> 验证 -> 回流记忆”的核心价值；同时通过每阶段的小型架构收敛，避免系统继续堆叠临时 runtime 分支。

### Consequences

- 短期重点会集中在 PR Pool、CodeAgent、RuntimeTask、Execution Engine job view、artifacts、verification，而不是 UI 或外部渠道。
- 第一阶段会承担额外契约设计成本，但可避免 PR Pool/CodeAgent 形成孤立执行语义。
- Memory、Scheduler、Gateway 的完整产品化会后移，但 evidence capture、job semantics、最小观测指标必须前置，避免后续无源回流或两套状态机。
- 每个 PR 切片都必须维护 docs/tests sync，单个阶段会拆成多个较小 PR。

### Follow-ups

1. 对本计划做一次 follow-up Critic review，确认 `ITERATE` 要求已完整落地。
2. 将 Phase 0/1 切片录入 PR Pool，优先执行当前分支收口、contract/schema、WorkflowRun persistence、confirmed dispatch、diff/evidence artifact、verification evidence。
3. 更新 `docs/GAP.md`，把本计划摘要纳入当前差距来源。
4. 为 Phase 1 设计一个固定 demo goal，作为后续 eval harness 的第一条 golden scenario。
5. 在 Phase 2 前确认 CodeAgent direct execution 的 hardened policy：confirmed PR Pool slice 允许 direct，其余默认 patch_proposal。

---

## 9. 建议立即进入 PR Pool 的前 10 个切片

1. **PR-0.1 当前 PR Pool/CodeAgent execution 分支收口验证**。
2. **PR-1.0 Execution Contract Skeleton：Job / Artifact / Approval / Workspace / Verification / Evidence contract/schema/projection tests**。
3. **PR-1.1 AI Dev E2E WorkflowRun persistence：RuntimeTask / resultRef / DomainEvent / resume cursor 串联**。
4. **PR-1.2 Confirmed PR Pool mode：confirmed item 创建 Execution Job / WorkflowRun，draft/generated item 不自动执行**。
5. **PR-1.3 Confirmed-run dispatch：PR Pool develop 创建并 dispatch CodeAgent child RuntimeTask**。
6. **PR-1.4 Diff / evidence artifact：受限 workspace 产出 diff、logs、summary refs，主路径只携带 compact refs**。
7. **PR-1.5 Verification evidence：typecheck/test/change-sync/GitNexus evidence 关联到 job 与 PR Pool item**。
8. **PR-1.6 Reconcile + memory/docs candidate refs：completed/failed item 生成 governed writeback candidates，不直接污染长期记忆**。
9. **PR-2.1 Safety hardening：patch-first 默认策略、workspace/approval/network/write/ordered execution policy runtime 化**。
10. **PR-3.1 Registry extraction + lint baseline：Router/Dispatcher/Execution Engine contract 防漂移，并补 lint 质量门禁**。

这些切片完成后，系统将从“模块很多、路径存在”推进到“主路径可验证、执行可审查、结果可回流”。其中 PR-1.0 必须先于其他 Phase 1 切片进入 PR Pool，确保后续所有实现都按未来 Execution Engine / MemoryRuntime / Capability Contract 可提升的形态落地。