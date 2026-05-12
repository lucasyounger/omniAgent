# Channels

Channels connect mobile messaging apps to OmniAgent through Omni Gateway.

The gateway follows the same core idea as local-first agent gateways: channel
adapters handle messaging protocols, while OmniAgent execution still flows
through Team Runtime.

## Current Implementation

- HTTP webhook adapter: `POST /message`
- OneBot-like webhook adapter: `POST /onebot`
- Pairing or allowlist authorization
- `/task <workspacePath> :: <objective>` for async CodeAgent execution
- Natural language forwarding to OmniRouterAgent
- Delivery worker for Team Runtime results addressed to `channel-gateway`
- Delivery idempotency, retry attempts, and dead-letter status

## Runtime

Start OmniAgent first, then start the gateway:

```shell
npm run dev
npm run gateway
```

Gateway default URL:

```text
http://localhost:4120
```

## Security

Remote channel input is untrusted by default. Use pairing or sender allowlists.
Do not expose this HTTP server directly to the public internet without an
authenticated reverse proxy.
