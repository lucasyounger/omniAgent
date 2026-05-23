# Goal 管理指南（QQ Bot / 渠道命令）

OmniAgent Goal 是一个持久化长期目标系统，支持创建、查看、执行、反馈的完整生命周期。Goal 适合需要多轮迭代、分阶段推进的任务（如模块优化、主题研究），不适合一次性提醒或即时消息。

所有命令通过 QQ Bot、HTTP、OneBot 等已配对渠道发送即可生效。

---

## 1. 命令格式

```
/goal <子命令> [参数]
```

| 子命令 | 用途 | 示例 |
|--------|------|------|
| `create` | 创建 Goal | `/goal create 长期优化 memory 模块` |
| `list` | 列出 Goal | `/goal list` |
| `status` | 查看 Goal 详情 | `/goal status goal-xxx` |
| `run` | 手动触发一轮执行 | `/goal run goal-xxx` |
| `feedback` | 给 Goal 反馈 | `/goal feedback goal-xxx 暂停` |

无子命令或未知子命令时返回帮助信息。

---

## 2. 创建 Goal

### 2.1 基本用法

```
/goal create <目标内容>
```

示例：

```
/goal create 研究 AI Agent 长期记忆
/goal create 长期优化 memory 模块 --auto-run
/goal create 改进 orchestrator 模块
```

### 2.2 自动类型推断

系统根据内容关键词自动推断 Goal 类型：

| 关键词 | 推断类型 |
|--------|----------|
| `模块`、`改进`、`重构`、`module` | `module_improvement` |
| `助理`、`提醒`、`个人`、`assistant` | `personal_assistant` |
| `自动化`、`流程`、`workflow` | `workflow_automation` |
| 其他 | `topic_research`（默认） |

### 2.3 自动运行

在内容末尾加 `--auto-run` 或 `自动运行`，创建后会立即创建首轮 Run，并同时创建 `goal.run` RuntimeTask 进入统一调度队列：

```
/goal create 研究 AI Agents --auto-run
/goal create 改进 runtime 模块 自动运行
```

后台 RuntimeTask dispatcher 会按 `OMNI_TASK_DISPATCH_POLL_INTERVAL_MS` 轮询 pending 任务；渠道命令路径会在创建 RuntimeTask 后立即尝试派发。

### 2.4 创建成功后

- 返回 Goal ID（格式如 `research-ai-agent-xxx`）
- 如有 `--auto-run`，同时返回首轮 Run ID；该 Run 会通过 `goal.run` RuntimeTask 进入调度队列
- Goal 自动关联到当前会话上下文，后续"继续""再看看"等指代会自动关联

---

## 3. 自然语言创建

除 `/goal create` 外，以下自然语言也会触发 Goal 创建：

| 输入 | 行为 |
|------|------|
| `创建目标：研究 AI Agent 长期记忆` | 直接创建 |
| `创建一个目标：优化 memory 模块` | 直接创建 |
| `我想长期优化 memory 模块` | 创建 + 自动运行 |
| `帮我持续改进 runtime` | 创建 + 自动运行 |
| `帮我分析一下 memory 模块` | 需确认后才创建 |

> 模糊表达（如"帮我分析一下..."）会先询问是否要创建 Goal，回复 `创建目标：<内容>` 确认。

---

## 4. 列出 Goal

```
/goal list
/goal list active
/goal list topic_research
/goal list tag=memory
```

可选筛选参数：

| 参数 | 说明 |
|------|------|
| `active` / `paused` / `waiting_feedback` / `completed` / `failed` | 按状态筛选 |
| `topic_research` / `module_improvement` / `personal_assistant` / `workflow_automation` | 按类型筛选 |
| `tag=<标签>` | 按标签筛选 |

自然语言等价：

```
列出目标
查看我的目标
查询目标
```

输出示例：

```
Goal 列表：
research-ai-agent-xxx | active | topic_research | 2026-05-23 09:30 | 研究 AI Agent 长期记忆
memory-module-xxx | paused | module_improvement | 2026-05-23 10:15 | 长期优化 memory 模块
```

---

## 5. 查看 Goal 状态

```
/goal status <goalId>
```

示例：

```
/goal status research-ai-agent-xxx
```

自然语言等价：

```
目标状态 research-ai-agent-xxx
查看目标 research-ai-agent-xxx
查询目标 research-ai-agent-xxx
```

输出示例：

```
ID: research-ai-agent-xxx
Title: 研究 AI Agent 长期记忆
Status: active
Type: topic_research
Updated: 2026-05-23 09:30
Created: 2026-05-23 09:00
Objective: 研究 AI Agent 长期记忆
Latest Run: run-xxx | succeeded | 完成首轮调研
Feedback: 2
```

---

## 6. 执行 Goal Run

```
/goal run <goalId>
```

手动触发一轮 Goal 执行。`run-goal` 会先创建 pending GoalRun，再创建 `goal.run` RuntimeTask；实际执行由 RuntimeTask dispatcher 负责。Goal Run 会根据类型路由到对应的 Workflow：

| Goal 类型 | 执行路径 |
|-----------|----------|
| `topic_research` | `topic-research-goal-workflow` |
| `module_improvement` | `module-improvement-goal-workflow` |

自然语言等价：

```
运行目标 goal-xxx
执行目标 goal-xxx
启动目标 goal-xxx
```

输出示例：

```
Goal Run 已完成：run-xxx
完成首轮调研，发现 3 个关键方向
```

---

## 7. 给 Goal 反馈

```
/goal feedback <goalId> <反馈内容>
```

示例：

```
/goal feedback goal-xxx 暂停
/goal feedback goal-xxx 恢复
/goal feedback goal-xxx 优先级需要提高
/goal feedback goal-xxx 重点分析第三个方向
/goal feedback goal-xxx 本轮结果不错
```

系统自动推断反馈动作：

| 关键词 | 动作 |
|--------|------|
| `暂停`、`pause` | 暂停 Goal |
| `恢复`、`继续`、`resume` | 恢复 Goal |
| `取消运行`、`cancel` | 取消当前 Run |
| `优先级`、`priority` | 修改优先级 |
| `深入`、`重点分析`、`deep` | 深入分析 |
| 其他 | 记录为备注（note） |

自然语言等价：

```
反馈目标 goal-xxx 暂停
给目标反馈 goal-xxx 恢复运行
```

---

## 8. Goal 生命周期

```
创建 → active → (run) → waiting_feedback → (feedback) → active → ... → completed
                ↓                              ↓
              paused ────────── 恢复 ─────→ active
                ↓
              failed
```

| 状态 | 含义 |
|------|------|
| `active` | 正常运行中，可触发 Run |
| `paused` | 已暂停，不自动触发 |
| `waiting_feedback` | 等待用户反馈后继续 |
| `completed` | 已完成 |
| `failed` | 执行失败 |

---

## 9. 与定时任务的区别

| 特性 | Goal | 定时任务（Schedule） |
|------|------|----------------------|
| 适合场景 | 长期、分阶段、需迭代 | 固定时间重复执行 |
| 创建命令 | `/goal create ...` | 自然语言："每天 9 点提醒我" |
| 执行方式 | 手动或自动触发 Run | 按 Cron 表达式自动触发 |
| 反馈支持 | 支持（暂停/恢复/深入） | 不支持 |
| 持久性 | 有状态，记录 Run 和 Artifact | 触发即忘，仅记录结果 |

> 如果你想创建一个**有时间规律的重复任务**，用自然语言描述时间即可（如"每天 9 点发 AI 日报"），系统会走 Schedule 路径。如果目标是**渐进式推进某件事**，用 Goal。
