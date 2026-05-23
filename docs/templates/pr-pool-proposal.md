---
title: Add PR Pool proposal ingest
source: exploration
priority: normal
risk: medium
modules:
  - PR Pool
  - Goal Runtime
files:
  - src/mastra/runtime/pr-pool/pr-pool-store.ts
testCommand: npx vitest run tests/pr-pool-store.test.ts tests/task-dispatcher.test.ts
tags:
  - pr-pool
  - goal
origin:
  type: claudecode
  artifactPath: .omc/plans/example.md
---

# Objective

把已确认的方案录入 PR Pool，形成可追溯 PR 切片。

# Background

说明方案来源、问题背景和为什么需要落地。

# Acceptance Criteria

- 录入后创建 draft PRItem。
- PRItem 保留 origin metadata。
- 不绕过 confirm/develop 状态机。

# 4+1 Design

## Logical

PRPoolProposal 是外部方案进入 PR Pool 的标准中间格式。

## Process

1. 方案生成。
2. 用户确认录入。
3. 系统转换成 PRPoolProposal。
4. Runtime 创建 PRItem draft。
5. 用户 confirm 后进入 ready。

## Development

Runtime 负责校验和写入；CLI/skill 只负责采集和调用。

## Physical

PRItem 存储在 `~/.omni/pr-pool/active/items.json`。

## Scenarios

- Goal 定时探索产出 proposal 后录入。
- ClaudeCode 方案文档录入。
- OpenCode 方案文档录入。

# CodeAgent Prompt

请按该方案实现最小闭环，保持代码、测试、文档同步。
