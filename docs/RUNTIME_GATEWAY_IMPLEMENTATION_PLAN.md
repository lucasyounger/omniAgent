# OmniAgent Runtime/Gateway 落地计划

## 目标

把 OmniAgent 从“多 Agent Demo”稳定演进为本地个人助手 Runtime，主链路固定为：

```text
QQBot / OneBot / HTTP / CLI
  -> Gateway
  -> Orchestrator
  -> TaskRuntime
  -> TaskDispatcher(taskType registry)
  -> Handler / Agent
  -> Result Artifact
  -> Notify Handler
  -> Gateway Delivery
  -> User Channel
```

所有阶段都沿这条链路小步迭代，避免后期大改。任何临时能力必须使用最终架构里的协议边界，不能让 Agent 直接承担基础设施职责。

## 架构边界

- Gateway 只负责通道接入、鉴权、标准化消息、出站投递、重试和 dead letter。
- Orchestrator 只负责把自然语言转换成 `taskType + payload + notifyTarget`。
- TaskRuntime 只负责任务生命周期、状态机、事件和结果引用。
- SchedulerRuntime 到点后只创建 RuntimeTask，不直接调用 Agent 或通道 API。
- TaskDispatcher 以 `taskType` 为第一分发键，`targetAgentId` 只做兼容和执行者提示。
- Handler/Agent 负责业务执行，但通知必须走 Notify/Delivery。
- ToolGateway 是所有高风险副作用的边界。

## 稳定协议

### ChannelTarget

```ts
{
  channel: "qqbot" | "onebot" | "http" | "cli" | string
  accountId: string
  conversationId: string
  senderId?: string
  messageType: "dm" | "group" | "guild" | "system"
}
```

### RuntimeTask

```ts
{
  taskType: string
  payload: Record<string, unknown>
  notifyTarget?: ChannelTarget
  source?: {
    kind: "channel" | "scheduler" | "agent" | "user"
    channel?: string
    conversationId?: string
    senderId?: string
  }
}
```

### Schedule

```ts
{
  id: string
  schedule: string
  taskType: string
  payload: Record<string, unknown>
  notifyTarget?: ChannelTarget
}
```

## 分阶段实施

## 实施记录

- 2026-05-13 Step 1 已完成：建立 `taskType` registry、`notifyTarget` 持久化和 Delivery 读取优先级；已通过 `npm test`、`npm run typecheck`、`npm run dev` API 验证，并推送到 GitHub。
- 2026-05-13 Step 2 已完成：Gateway 定时自然语言入口改为创建 `schedule.create` RuntimeTask；Dispatcher 按 `taskType` 进入 schedule handler；handler 持久化 Schedule 并返回结构化结果。已通过 `npm test`、`npm run typecheck`、`npm run dev` API 验证。
- 2026-05-13 Step 3 已完成：实现 `notify.send_channel_message` handler，普通通知进入 Gateway Delivery Queue；Delivery 支持 pending 投递、失败重试、dead letter 查询和 HTTP 查询接口。已通过 `npm test`、`npm run typecheck`、`npm run dev`、Gateway HTTP 状态接口验证，并推送到 GitHub。
- 2026-05-13 Step 4 已完成：实现 `research.ai_daily_digest` MVP，生成可验证日报文本，并通过 `notify.send_channel_message` 回推原会话。已通过 Schedule -> Research -> Notify -> Delivery Queue 单元测试、`npm test`、`npm run typecheck`、`npm run dev` 验证，并推送到 GitHub。
- 2026-05-13 Step 5 代码已实现，真实 QQ 消息回环未验证：QQBot adapter 增加安全状态查询和事件归一化测试；`.env` QQBot 凭据可获取 access token，websocket 可进入 READY，Gateway `/qqbot/status` 返回正常。尚未由用户在 QQ 内发送真实 C2C/group-at 消息验证“定时创建 -> 触发 -> 回到同一 QQ 会话”。
- 2026-05-13 Step 6 代码已实现，真实 QQ 覆盖未验证：新增 Runtime Orchestrator 规则解析和严格 JSON schema 校验；Gateway 自然语言入口统一转换为 `taskType + payload + notifyTarget` RuntimeTask，覆盖一次性提醒、每日 AI 日报、即时通知、状态查询和低置信度澄清。已通过 `npm test`、`npm run typecheck`、`npm run dev` 端口探测、临时 Gateway HTTP 日报创建验证；尚未完成 QQBot 真实每日定时、一次性提醒、查询状态验收。
- 2026-05-13 Step 7 已完成：新增独立 RuntimeTask file store 和 append-only runtime timeline；TaskRuntime 写入 `~/.omni/runs/runtime-tasks`，保留 TeamTask metadata 镜像并支持旧 TeamTask-only 数据按需迁移；runtime record/timeline 保留 `resultRef`、`approvalRequestId`、`approvalToken`。已通过迁移测试、审批链路测试、`npm test`、`npm run typecheck`、`npm run dev` 端口探测。

### Step 1: Runtime/Gateway 协议地基

目标：
- 新增 `taskType` registry，明确核心任务类型和默认执行者。
- `CronJob/Schedule` 持久化顶层 `notifyTarget`。
- Scheduler 创建 RuntimeTask 时复制 `notifyTarget`。
- Gateway Delivery 优先从 `notifyTarget` 回推，兼容旧 `payload.source`。

验收：
- `npm test`
- `npm run typecheck`
- `npm run dev` 能启动，Mastra API 能响应。
- Git commit + push 到 GitHub。

### Step 2: schedule.create Handler

目标：
- Dispatcher 按 `taskType` 分发。
- 实现 `schedule.create` handler，创建 Schedule 并返回结构化结果。
- Gateway 自然语言入口不直接 `createCronJob`，而是创建 `schedule.create` RuntimeTask。

验收：
- 单元测试覆盖 Gateway -> TaskRuntime -> schedule.create -> CronJob。
- `npm test`
- `npm run typecheck`
- 本地 `npm run dev` 能启动并调用 Mastra API。
- Git commit + push 到 GitHub。

### Step 3: notify.send_channel_message Handler

目标：
- 实现通用通知 handler。
- 普通通知和任务结果通知都进入 Gateway Delivery Queue。
- Delivery 支持幂等键、重试、dead letter 查询。

验收：
- 单元测试覆盖 `notifyTarget` 投递、失败重试、dead letter。
- 本地 `npm run dev` + Gateway 能发送 HTTP/OneBot 测试消息。
- Git commit + push 到 GitHub。

### Step 4: research.ai_daily_digest MVP

目标：
- 实现最小研究日报 handler。
- 先生成可验证的结构化日报文本，后续再接 arXiv/GitHub/PapersWithCode。
- 执行结束后通过 `notify.send_channel_message` 回推原会话。

验收：
- 单元测试覆盖 Schedule 到 Research 到 Notify。
- 本地 `npm run dev` 能手动触发 research task。
- Git commit + push 到 GitHub。

### Step 5: QQBot 真实闭环

目标：
- 通过 `.env` 中 QQBot 配置真实收发消息。
- 用户在 QQ 里用自然语言创建定时任务。
- 手动或短周期触发后，结果回到同一 QQ 会话。

验收：
- `npm run dev` 运行正常。
- Gateway/QQBot adapter 运行正常。
- 给 `.env` 配置的 QQBot 发送真实测试消息。
- 检查 Schedule、RuntimeTask、Delivery 状态。
- 结果真实回到 QQ。
- Git commit + push 到 GitHub。

### Step 6: Orchestrator 结构化自然语言解析

目标：
- LLM 输出严格 JSON schema。
- 支持 `schedule.create`、`research.ai_daily_digest`、`notify.send_channel_message`。
- 对低置信度解析给出澄清问题。

验收：
- 规则解析和 LLM schema 测试。
- QQBot 真实测试至少覆盖每日定时、一次性提醒、查询状态。
- Git commit + push 到 GitHub。

### Step 7: Runtime 持久化和事件时间线

目标：
- RuntimeTask 从 TeamTask metadata 逐步独立为更稳定的 store。
- 增加 task event timeline、result artifact、approval linkage。
- 保持外部协议不变。

验收：
- 迁移测试覆盖旧数据兼容。
- `npm test`
- `npm run typecheck`
- Git commit + push 到 GitHub。

## 每轮工作规则

每一轮只推进一个 Step 或一个明确子目标。完成标准：

1. 代码开发完成。
2. 相关自动化测试通过。
3. `npm run typecheck` 通过。
4. 涉及本地服务的能力，必须启动 `npm run dev` 验证。
5. 涉及 QQBot 的能力，必须用 `.env` 配置的 QQBot 发送真实测试消息验证。
6. 提交 commit。
7. 推送到 GitHub。
8. 下一步优化重新开启对话，先读取本计划和最新代码状态再继续。

未真实验证的能力不能标记为完成，只能标记为“代码已实现，真实链路未验证”。
