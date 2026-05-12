# HTTP Channel

The HTTP channel is the simplest way to test phone-like messaging before
connecting a real QQ or OneBot adapter.

## Endpoint

```text
POST http://localhost:4120/message
```

## Example

```json
{
  "channel": "http",
  "accountId": "local",
  "conversationId": "phone-demo",
  "senderId": "lucas-phone",
  "messageType": "dm",
  "text": "/status"
}
```

## Commands

- `/pair <token>`
- `/help`
- `/status`
- `/task <workspacePath> :: <objective>`

Normal text is forwarded to OmniRouterAgent for synchronous response.
