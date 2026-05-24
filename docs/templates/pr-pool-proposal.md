---
title: Add PR Pool confirmed ingest semantics
source: manual
confirmation: confirmed
priority: normal
risk: medium
modules:
  - PR Pool
  - Goal Runtime
  - CLI
files:
  - src/mastra/runtime/pr-pool/pr-pool-store.ts
testCommand: npx vitest run tests/pr-pool-store.test.ts tests/pr-pool-runtime.test.ts tests/task-dispatcher.test.ts tests/pr-pool-ingest-cli.test.ts
tags:
  - pr-pool
  - goal
origin:
  type: manual
  artifactPath: .omc/pr-pool-confirmed-ingest-requirements.md
references:
  - type: file
    path: .omc/pr-pool-confirmed-ingest-requirements.md
    summary: Confirmed ingest requirements slice.
---

# Objective

把用户已确认的需求切片录入 PR Pool ready 队列，同时让 Goal 自动生成的候选需求默认进入 draft 等待确认。

# Non-goals

- 不把完整探索过程嵌入 PRItem brief。
- 不在 ingest 阶段创建 CodeAgent task。
- 不改变 develop 执行链路。

# Constraints

- Goal-origin proposal 默认 `confirmation: required`。
- 只有 `ready` PRItem 可被 PR Pool cron scan 消费。
- references 只保存路径、id、摘要等可追溯信息。

# Acceptance Criteria

- confirmed proposal 创建 ready PRItem。
- Goal proposal 缺省创建 draft PRItem。
- PRItem 保留 confirmation、nonGoals、constraints、references metadata。
- active brief 包含目标、边界、影响、验收、验证和引用摘要。

# 4+1 Design

## Logical

PRPoolProposal 是外部方案进入 PR Pool 的标准中间格式，`confirmation` 决定初始 PRItem 状态。

## Process

1. 方案生成或用户手动确认。
2. CLI/Skill/Goal 调用 Runtime ingest API。
3. Runtime 校验 proposal 并解析 confirmation。
4. `required` 写入 draft；`confirmed` 写入 ready。
5. PR Pool cron scan 后续只消费 ready。

## Development

Runtime 负责校验、写入、brief 生成和事件记录；CLI/skill 只负责采集和调用。

## Physical

PRItem 存储在 `~/.omni/pr-pool/active/items.json`，AI 主消费 brief 存储在 `~/.omni/pr-pool/active/{prItemId}/brief.md`。

## Scenarios

- Goal 定时探索产出 proposal 后录入 draft。
- 用户手动确认方案文档后通过 `--confirmed` 录入 ready。
- OpenCode/ClaudeCode 方案文档录入后保留 references 追溯。

# CodeAgent Prompt

请按该方案实现最小闭环，保持代码、测试、文档同步。
