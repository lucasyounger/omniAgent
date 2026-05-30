# Req Library

OmniAgent stores requirement drafts in `.omni/reqs` with a shared index and one folder per Req document:

```text
.omni/reqs/
  reqs.json
  REQ-YYYYMMDD-001/
    req.md
    design-4plus1.md
    source.json
    status-events.jsonl
```

Req documents use two-level confirmation. The document status starts as `pending_user_confirmation`; each item also starts as `pending_user_confirmation` and can be confirmed, rejected, planned, in progress, implemented, or verified independently.

Module-improvement Goal runs now emit `req-list.md` and `reqs.json`, then create a pending Req draft with source metadata pointing to the Goal ID, run ID, and artifacts. Conversation imports from Claude Code, opencode, or manual markdown use the same Req library and default to pending unless the user asks to confirm and archive.

Repository research uses `OMNI_REPO_PROVIDER=github|mock`. GitHub mode requires `GITHUB_TOKEN`; the provider only reads repository metadata and text files through GitHub APIs and never executes external code. Candidate repos include URL, stars, description, topics, and fetchedAt.

Daily Goal scanning is opt-in with `OMNI_GOAL_DAILY_SCAN_ENABLED=true`. Configure `OMNI_GOAL_DAILY_SCAN_CRON` (default `0 0 * * *`) and `OMNI_GOAL_DAILY_SCAN_TIMEZONE` (default `local`).

Channel commands:

- `/req list`
- `/req status <id>`
- `/req confirm <id>`
- `/req reject <id> <reason>`
- `/req confirm-item <id> <itemId>`
- `/req reject-item <id> <itemId> <reason>`
- `/req import <markdown>`

Chinese examples include “查看待确认需求”, “确认需求 REQ-20260523-001”, “确认 REQ-20260523-001 里的 R1”, and “把这份 claudecode 需求文档导入需求库”.
