# Channel Security

Remote channel messages can trigger local actions. Treat them as untrusted.

## Current Controls

- `OMNI_GATEWAY_PAIRING_TOKEN`: pairs a sender with `/pair <token>`.
- `OMNI_GATEWAY_ALLOW_SENDERS`: semicolon-separated sender allowlist.
- Gateway writes tasks with `sourceAgentId: channel-gateway`.
- Async task results return through Team Runtime inbox and delivery worker.

## Required Rules

- Do not expose `OMNI_GATEWAY_PORT` directly to the public internet.
- Keep QQ/OneBot credentials out of docs and git.
- Prefer allowlists for personal bots.
- Use approval gates before allowing remote write-heavy tasks.
- Keep channel metadata in Team Task metadata so results can be routed back.

## Next Security Enhancements

- Approval workflow for medium/high risk remote tasks.
- Mention-only group policy.
- Per-channel workspace permissions.
- Rate limits per sender and conversation.
