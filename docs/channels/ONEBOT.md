# OneBot-Like Channel

The OneBot-like channel is intended for NapCat or other OneBot-compatible QQ
bridges.

## Inbound

Configure the OneBot implementation to POST message events to:

```text
http://localhost:4120/onebot
```

Supported fields:

- `post_type`
- `message_type`
- `user_id`
- `group_id`
- `message_id`
- `raw_message`
- `sender.nickname`

## Outbound

Set `OMNI_ONEBOT_HTTP_URL` to the OneBot HTTP API base URL. The adapter registry
reports `onebot` as configured and outbound-capable only when this URL is set.
The gateway sends:

- `send_private_msg` for direct messages
- `send_group_msg` for group messages

## Caveat

OneBot/NapCat is useful for local personal QQ testing but has platform and
stability risks. For long-term public bot usage, prefer an official QQ Bot
adapter behind the same gateway interface.
