# Channel Security

Remote channel messages can trigger local actions. Treat them as untrusted.

## Current Controls

- `OMNI_GATEWAY_PAIRING_TOKEN`: pairs a sender with `/pair <token>`.
- `OMNI_GATEWAY_ALLOW_SENDERS`: semicolon-separated sender allowlist.
- Gateway writes tasks with `sourceAgentId: channel-gateway`.
- Async task results return through Team Runtime inbox and delivery worker.
- Delivery records use idempotency keys, retry attempts, and `dead_letter`
  status after max attempts.

## Required Rules

- Do not expose `OMNI_GATEWAY_PORT` directly to the public internet.
- Keep QQ/OneBot credentials out of docs and git.
- Prefer allowlists for personal bots.
- Use workspace allowlists and audit records before allowing remote write-heavy tasks.
- Do not use Tool Gateway approval for routine schedule maintenance. Listing,
  deleting, pausing, and resuming schedules should be audited; bulk or
  ambiguous operations should use a chat confirmation layer when implemented.
- `schedule.run_now` must inspect the scheduled task. Ordinary reminders can
  run without approval; direct code execution uses the CodeAgent allowed-workspace
  boundary plus Tool Gateway audit records instead of a second approval gate.
- Keep channel metadata in Team Task metadata so results can be routed back.

## Next Security Enhancements

- Mention-only group policy.
- Per-channel workspace permissions.
- Rate limits per sender and conversation.
- Chat confirmation state for bulk schedule deletion and other ambiguous
  medium-risk operations.
