# Goal Channel Integration 全路线落地文档

来源：`.omc/gap.md`

## 目标

一次性打通 QQbot / OmniAgent 自然语言入口到 Goal Runtime 的完整闭环：

```text
QQbot / OmniAgent Chat / CLI
  -> GoalChannelRequest
  -> RuntimeTask(goal.*)
  -> TaskDispatcher
  -> GoalService
  -> GoalStore / GoalRunStore / EventLog / FeedbackStore
  -> Goal Workflow / Notify
```

## 落地原则

1. 创建 Goal 不同步执行长 workflow；仅在 `autoRun=true` 时排队 `goal.run`。
2. 外部入口统一转成 `GoalChannelRequest`，避免 QQbot、CLI、Agent Tool 各写业务逻辑。
3. 自然语言明确创建才落库；模糊分析类表达必须先返回确认态。
4. 所有状态变化写 `event-log.jsonl`。
5. 通过 `actorId/channelId/idempotencyKey` 做权限、审计与防重复创建。
6. 代码、文档、测试同步更新，并通过 `npm run verify:change-sync`。

## 一次性执行范围

### PR-1：Goal Runtime Service MVP

范围：

- 补齐 `goal.create/list/status/run/feedback` task type。
- 新增或补齐 GoalService：`createGoal()`、`listGoals()`、`getGoalStatus()`、`enqueueGoalRun()`、`applyFeedback()`。
- 新增或补齐 Goal ID、幂等索引、事件日志能力。
- TaskDispatcher 接入 `goal.*` handler，dispatcher 保持薄。
- 测试覆盖 service 与 dispatcher。

验收：

- `RuntimeTask(goal.create)` 能写入 `~/.omni/goals/{goalId}/goal.json`。
- 重复 `idempotencyKey` 返回既有 Goal，不重复创建。
- `goal.list` 支持 status/type/tag 过滤。
- `goal.status` 返回 Goal 与 latest GoalRun 摘要。
- `goal.run` 创建 GoalRun 并记录状态。
- `goal.feedback` 支持 note/pause/resume/cancel_run/deep_dive/change_priority。

### PR-2：QQ `/goal` 命令入口

范围：

- 新增 `goal-channel` 类型、parser、formatter、permission。
- message-handler 接入 `/goal create/list/status/run/feedback`。
- `/help` 文案补充 Goal 命令。
- QQ messageId 生成 `idempotencyKey` 防重。

验收：

- `/goal create ...` 创建 Goal。
- `/goal list` 返回列表。
- `/goal status <goalId>` 返回状态。
- `/goal run <goalId>` 排队或启动一次 run。
- `/goal feedback <goalId> <text>` 记录反馈并按 intent 应用状态。
- 未授权 actor/channel 不能执行受限操作。

### PR-3：自然语言 Goal 创建入口

范围：

- Orchestrator 增加 goal intent：create、create.confirm、list、status、run、feedback。
- 明确创建表达直接创建。
- 模糊分析表达返回确认卡片，不落库。
- “确认创建” 使用 pending confirmation 创建 Goal。

验收：

- “创建一个目标：xxx” -> `goal.create`。
- “帮我分析 xxx” -> confirm，不落库。
- “确认创建” -> `goal.create`。
- 原有 schedule / notify / research / status intent 不被 goal intent 抢占。

### PR-4：Goal Run + Workflow 异步执行

范围：

- `goal.run` handler 读取 Goal，创建 GoalRun，路由 workflow。
- 注册 Goal workflows。
- workflow 支持 `notifyTarget` 与 `runMode`。
- 成功/失败写 run 状态、output/error、event log。
- 完成后创建 notify task 或返回可推送摘要。

验收：

- `/goal run xxx` 产生 queued/running/succeeded 或 failed 状态。
- `--auto-run` 只排队 `goal.run`，不阻塞 `goal.create`。
- workflow 成功后可推送摘要。
- workflow 失败后 `goal.status` 可看到错误摘要。

### PR-5：Feedback + Agent Tools

范围：

- `goal.feedback` 支持 pause/resume/note/deep_dive/cancel_run/change_priority。
- 新增 Goal Mastra tools：create/list/status/run/feedback。
- OmniRouterAgent 接入 goal tools 与路由说明。
- HTTP `/goals` API 仅在不扩大风险时实现；必须复用 GoalService。

验收：

- “暂停目标 xxx” -> Goal paused。
- “继续目标 xxx” -> Goal active。
- Agent 能创建、查询、运行、反馈 Goal。
- HTTP API 若实现，不绕过 GoalService。

## 关键文件路线

### Runtime / Domain

- `src/mastra/runtime/task-types.ts`
- `src/mastra/runtime/task-dispatcher.ts`
- `src/mastra/runtime/goal/goal-service.ts`
- `src/mastra/runtime/goal/goal-run-store.ts`
- `src/mastra/runtime/goal/index.ts`

### Channel / Gateway

- `src/mastra/runtime/goal-channel/goal-channel-request.ts`
- `src/mastra/runtime/goal-channel/goal-channel-parser.ts`
- `src/mastra/runtime/goal-channel/goal-channel-formatter.ts`
- `src/mastra/runtime/goal-channel/goal-permission.ts`
- `src/mastra/runtime/goal-channel/index.ts`
- `src/gateway/message-handler.ts`
- `src/mastra/runtime/orchestrator.ts`

### Workflow / Tools / Agent

- `src/mastra/tools/goal-tools.ts`
- `src/mastra/tools/index.ts`
- `src/mastra/agents/omni-router-agent.ts`

### Docs

- `docs/GOAL_RUNTIME.md`
- `docs/GOAL_CHANNEL_INTEGRATION.md`
- `docs/agents/TASK_AGENT.md`
- `docs/knowledge/TEAM_RUNTIME.md`
- `docs/channels/HTTP.md`
- `docs/channels/README.md`
- `docs/agents/OMNI_ROUTER_AGENT.md`

### Tests

- `tests/goal-runtime.test.ts`
- `tests/task-dispatcher.test.ts`
- `tests/gateway-message-handler.test.ts`
- `tests/orchestrator.test.ts`

## 执行顺序

1. 对齐现有 Goal schema/store/run/workflow API。
2. 实现 GoalService 与缺失的 domain helper。
3. 注册 `goal.*` TaskType 并接入 TaskDispatcher。
4. 实现 goal-channel request/parser/formatter/permission。
5. 接入 gateway `/goal` 命令与 help 文案。
6. 接入 orchestrator goal intent 与确认态。
7. 接入 `goal.run` 排队状态与 status 摘要。
8. 接入 feedback 状态变更与 agent tools。
9. 更新 docs 与 tests。
10. 运行验证：

```bash
npm run typecheck
npm test
npm run verify:change-sync
npm run index:code
```

11. 运行 `gitnexus_detect_changes({scope: "all"})`。
12. 提交并推送到 GitHub `master`。

## 风险控制

- 修改任何函数/类/方法前先运行 GitNexus impact。
- HIGH/CRITICAL 风险先暂停并告知用户。
- 不用 find-and-replace 重命名符号。
- 不绕过 pre-commit hooks。
- 不使用 `--no-verify`。
- 不用同步 workflow 阻塞 QQbot 消息处理。

## 完成定义

- `.omc/all-route-plan.md` 已生成。
- Goal create/list/status/run/feedback 入口可用。
- QQ `/goal` 与自然语言创建/确认态可用。
- Goal run 能记录状态并生成可推送结果。
- Feedback 能影响 Goal 状态。
- Agent tools 可复用 GoalService 或 RuntimeTask。
- 文档和测试同步。
- `typecheck`、`test`、`verify:change-sync`、`index:code` 通过。
- 变更已提交并推送到 GitHub `master`。
