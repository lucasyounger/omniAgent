# Pitfalls Index

This file is a compact map of issues already encountered. Read it before
debugging OmniAgent behavior.

## Mastra Dev Output

- `npm run build` can rewrite `.mastra/output` for production.
- A running dev server may then fail to serve Studio with missing
  `.mastra/output/studio/index.html`.
- Fix: stop the dev process, remove `.mastra/output`, restart `npm run dev`.

## Environment Variables

- `.env` must be loaded explicitly with `import 'dotenv/config'`.
- If omitted, Mastra can report missing `process.env.DEEPSEEK_API_KEY` even when
  `.env` exists.

## Project Root Resolution

- `process.cwd()` can drift inside Mastra dev/tool execution.
- Runtime paths should resolve from the OmniAgent project root, not cwd.
- This matters for `docs/runs/**` and other durable files.

## Claude Code On Windows

- Direct Node `spawn('claude')` can fail with `spawn claude ENOENT`.
- `cmd.exe` shell invocation can truncate prompts containing spaces.
- Current fix: call `powershell.exe`, read prompt from a temporary file, then run
  `claude -p`.

## Cron

- Cron is only a task source, not a result protocol.
- In-process scheduler only runs while OmniAgent is running.
- One-time jobs should pause after starting.
- Cron store must create missing directories and `jobs.json` on first use.

## Team Runtime

- Inbox is notification only; result files are the durable output.
- Prefer `inbox -> resultRef -> get-run-result` over reading raw code logs.
- Mark smoke-test inbox messages as read.
- File-backed event storage should not receive high-frequency noisy events.

## Docs Indexing

- Do not index `docs/runs/**` into long-term memory indexes.
- Runtime logs should be read only by specific task id, run id, or resultRef.
