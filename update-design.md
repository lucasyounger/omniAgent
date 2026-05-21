下面是一版重构后的 omniAgent.md 设计文档。

> 历史草案说明（2026-05-20）：本文是早期产品/架构设想，不代表当前实现状态。
> 当前实现以 `README.md`、`docs/START_HERE.md`、`docs/ARCHITECTURE.md`、`docs/TESTING.md`、源码和测试为准。
> 本文中关于目录、ScheduleAgent、ResearchAgent、NotifyTool、MemoryRuntime 和 Tool Gateway 的描述只能作为后续方向参考。

# omniAgent 本地个人助手设计文档

## 1. 设计目标

omniAgent 是一个运行在本地的个人 Agent 助手，目标是帮助用户处理日常工作、代码开发、知识管理、信息研究、定时任务和消息通知。

核心原则：

- Agent 负责理解、规划、决策
- Runtime 负责状态、调度、持久化
- Tool Gateway 负责工具调用、权限、安全审计
- Memory Runtime 负责记忆读写、索引和检索
- 业务能力通过插件化 Agent / Tool 扩展
- 所有高危操作必须可审计、可确认、可回滚

## 2. 总体架构

```text
┌──────────────────────────────┐
│          User Interface       │
│  Desktop / Web / CLI / QQBot  │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│          Orchestrator         │
│  意图识别 / 任务拆解 / 路由决策 │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│          Agent Layer          │
│  Research / Code / Knowledge  │
│  Schedule / Notify / Device   │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│         Runtime Layer         │
│ TaskRuntime / MemoryRuntime   │
│ SchedulerRuntime / EventBus   │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│        Tool Gateway           │
│ 权限控制 / 工具注册 / 审计 / 沙箱 │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│          Storage Layer        │
│ SQLite / Markdown / VectorDB  │
│ FileSystem / Git / Logs       │
└──────────────────────────────┘
3. 核心模块
3.1 Orchestrator

Orchestrator 是系统的大脑，但不是超级 Agent。

职责：

理解用户意图
判断任务类型
拆解复杂任务
路由到具体 Agent
判断是否需要用户确认
协调多 Agent 协作
追踪任务执行结果

不负责：

直接读写文件
直接执行代码
直接管理定时任务
直接写入记忆库
直接调用高危工具

示例：

用户：每天早上 9 点总结 AI 热点并发到 QQ

Orchestrator：
1. 识别为定时研究任务
2. 调用 ScheduleAgent 创建计划
3. SchedulerRuntime 持久化调度规则
4. 到点后创建 Task
5. ResearchAgent 执行研究
6. NotifyTool 发送 QQ 消息
7. MemoryRuntime 记录日报
4. Agent 设计
4.1 ResearchAgent

负责信息研究类任务。

能力：

抓取论文
分析 GitHub Trending
总结技术热点
生成日报、周报
提取趋势
维护研究主题偏好

不负责：

定时调度
消息发送
任务状态管理
4.2 CodeAgent

负责代码开发任务。

能力：

阅读代码仓库
生成代码
修改代码
生成测试
解释架构
生成 patch

高危限制：

默认不能直接写入用户项目
默认不能执行危险命令
修改前生成 diff
执行前进入沙箱
必要时等待用户确认
4.3 KnowledgeAgent

负责知识管理的智能决策层。

能力：

判断哪些信息值得记住
把零散信息整理成结构化知识
回答“我之前说过什么”
合并重复记忆
发现记忆冲突
整理项目知识库

不负责：

直接管理向量索引
直接操作数据库
直接监听文件
直接执行 embedding
直接做权限控制

对应基础设施：

KnowledgeAgent
        ↓
MemoryRuntime
        ↓
DocsStore / VectorIndex / EventLog
4.4 ScheduleAgent

ScheduleAgent 不是 Cron 执行器，而是定时任务配置助手。

负责：

创建定时任务
修改定时任务
暂停任务
恢复任务
查询任务执行历史
解释任务下次执行时间

不负责：

真正触发任务
失败重试
任务状态机
业务执行

对应基础设施：

ScheduleAgent
        ↓
SchedulerRuntime
        ↓
TaskRuntime
        ↓
Business Agent
4.5 NotifyAgent / NotifyTool

负责通知推送。

渠道：

QQ Bot
邮件
企业微信
Telegram
桌面通知

建议拆分：

NotifyAgent：决定通知内容和时机
NotifyTool：真正发送消息
4.6 DeviceAgent

负责本机设备操作。

能力：

文件搜索
应用启动
本地脚本调用
浏览器自动化
剪贴板辅助

必须经过 Tool Gateway 权限控制。

5. Runtime Layer
5.1 TaskRuntime

TaskRuntime 是系统核心基础设施。

职责：

创建任务
持久化任务
管理任务状态
失败重试
任务取消
任务暂停
任务恢复
执行日志
人工确认
任务依赖

任务状态：

created
pending
running
waiting_user_confirm
succeeded
failed
cancelled
retrying
paused

任务结构：

interface Task {
  id: string
  type: string
  status: TaskStatus
  payload: Record<string, any>
  result?: Record<string, any>
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  retryCount: number
  maxRetries: number
  createdBy: "user" | "scheduler" | "agent"
}
5.2 SchedulerRuntime

SchedulerRuntime 只负责“什么时候触发”。

职责：

cron 表达式解析
一次性任务
周期性任务
错过任务补偿
调度锁
持久化 schedule
到点后创建 Task

示例：

interface Schedule {
  id: string
  name: string
  cron: string
  taskType: string
  payload: Record<string, any>
  enabled: boolean
  timezone: string
  nextRunAt: string
}
5.3 MemoryRuntime

MemoryRuntime 是记忆基础设施。

职责：

短期记忆
长期记忆
语义检索
关键词检索
记忆版本管理
记忆来源记录
记忆隐私等级
记忆删除
记忆冲突检测

存储结构：

docs/
  memory/
  knowledge/
  projects/
  skills/
  context/

data/
  omni.db
  vector.index
  event-log.jsonl
5.4 EventBus

系统内部事件总线。

事件示例：

task.created
task.started
task.succeeded
task.failed
schedule.triggered
memory.created
memory.updated
tool.called
tool.denied
user.confirmed

用途：

Agent 协作
日志审计
UI 实时刷新
插件扩展
6. Tool Gateway

所有工具必须通过 Tool Gateway 调用。

职责：

工具注册
权限校验
参数校验
调用审计
危险操作拦截
沙箱执行
用户确认
结果标准化

工具分类：

safe:
  - 搜索
  - 读取公开信息
  - 本地只读检索

medium:
  - 写入本地文件
  - 创建日程
  - 修改记忆
  - 发送通知草稿

dangerous:
  - 执行 shell
  - 删除文件
  - 修改代码仓库
  - 自动发送消息
  - 调用外部 API 写操作

权限策略：

interface ToolPolicy {
  toolName: string
  riskLevel: "safe" | "medium" | "dangerous"
  requireConfirmation: boolean
  allowedPaths?: string[]
  deniedCommands?: string[]
  sandboxRequired: boolean
}
7. 本地助手典型流程
7.1 定时 AI 热点日报
SchedulerRuntime 到点触发
        ↓
TaskRuntime 创建 research.ai_daily_digest
        ↓
Orchestrator 分派给 ResearchAgent
        ↓
ResearchAgent 抓取 arXiv / GitHub / Papers with Code
        ↓
生成摘要
        ↓
MemoryRuntime 保存日报
        ↓
NotifyTool 推送 QQ
        ↓
TaskRuntime 标记成功
7.2 代码修改任务
用户提出修改需求
        ↓
Orchestrator 分派给 CodeAgent
        ↓
CodeAgent 读取代码
        ↓
生成修改方案
        ↓
生成 diff
        ↓
等待用户确认
        ↓
Tool Gateway 在沙箱中应用 patch
        ↓
运行测试
        ↓
返回结果
7.3 知识写入
用户说：记住这个项目采用 Mastra + LibSQL
        ↓
KnowledgeAgent 判断是否值得长期记忆
        ↓
MemoryRuntime 写入 docs/projects
        ↓
Indexer 更新全文索引和向量索引
        ↓
EventLog 记录来源
8. 推荐技术选型
Runtime
Node.js / TypeScript
SQLite / LibSQL
BullMQ 可选
node-cron / later.js
EventEmitter / lightweight event bus
Agent Framework
Mastra
LangGraph 可选
自定义 Orchestrator
Memory
Markdown
SQLite
LanceDB / Chroma / Qdrant
ripgrep / minisearch
Git 版本管理
Tool Sandbox
Docker
isolated workspace
allowlist filesystem
command denylist
patch-first workflow
UI
Web Console
Desktop App
CLI
QQ Bot
9. 目录结构建议
omniAgent/
├─ apps/
│  ├─ web/
│  ├─ desktop/
│  └─ qqbot/
├─ src/
│  ├─ orchestrator/
│  ├─ agents/
│  │  ├─ research/
│  │  ├─ code/
│  │  ├─ knowledge/
│  │  ├─ schedule/
│  │  └─ notify/
│  ├─ runtime/
│  │  ├─ task-runtime/
│  │  ├─ scheduler-runtime/
│  │  ├─ memory-runtime/
│  │  └─ event-bus/
│  ├─ tools/
│  │  ├─ gateway/
│  │  ├─ filesystem/
│  │  ├─ shell/
│  │  ├─ browser/
│  │  ├─ qq/
│  │  └─ search/
│  ├─ storage/
│  └─ config/
├─ docs/
│  ├─ memory/
│  ├─ knowledge/
│  ├─ projects/
│  ├─ skills/
│  └─ context/
├─ data/
│  ├─ omni.db
│  ├─ vector.index
│  └─ logs/
└─ omniAgent.md
10. MVP 阶段规划
Phase 1：基础骨架
Orchestrator
TaskRuntime
SchedulerRuntime
Tool Gateway
SQLite 持久化
基础 Web UI
Phase 2：知识系统
MemoryRuntime
Markdown 记忆
全文检索
向量检索
记忆来源记录
Phase 3：代码助手
CodeAgent
只读代码分析
patch 生成
用户确认后写入
沙箱执行测试
Phase 4：研究日报
ResearchAgent
GitHub Trending 抓取
arXiv 抓取
AI 热点总结
QQ Bot 推送
Phase 5：本地自动化
DeviceAgent
浏览器自动化
文件自动整理
日程联动
插件系统
11. 关键设计结论
11.1 定时任务不应该只是 CronAgent

推荐：

ScheduleAgent = 配置助手
SchedulerRuntime = 调度系统
TaskRuntime = 任务状态机
BusinessAgent = 实际执行者
11.2 KnowledgeAgent 不应该等于知识库

推荐：

KnowledgeAgent = 知识决策层
MemoryRuntime = 记忆基础设施
Indexer = 索引器
Retriever = 检索器
KnowledgeStore = 存储层
11.3 Router 不应该拥有所有工具

推荐：

Orchestrator 只负责路由
Tool Gateway 负责工具调用
Agent 负责业务理解
Runtime 负责状态管理
11.4 本地助手必须安全优先

所有高危行为必须满足：

有权限策略
有执行日志
有用户确认
有沙箱隔离
有失败回滚
有变更 diff
12. 最终定位

omniAgent 不应该只是一个多 Agent Demo，而应该是一个本地个人智能操作系统的雏形。

它的核心不是“有多少个 Agent”，而是：

稳定的任务系统
安全的工具系统
可信的记忆系统
可扩展的 Agent 系统
可观察的执行过程

Agent 是智能层，Runtime 才是系统底座。