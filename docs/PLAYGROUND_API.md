# Website playground and statistics API

This contract applies to the separate `clideck.com` website. The hosted
[WebMCP workspace](WEBMCP.md) instead calls its own same-origin `/mcp`.

## BFF boundary

Browser requests go to fixed `/api/mcp/*` handlers. Server-only upstream headers:

```text
Authorization: Bearer <CLIDECK_MCP_PLAYGROUND_TOKEN>
X-CliDeck-Client-Key: <daily base64url HMAC, 16–128 characters>
Content-Type: application/json
```

Upstream comes only from configuration. No generic proxy, cookie/browser-auth/IP
forwarding or body logging. JSON limit 64 KiB; interactive responses `no-store`;
30-second timeout; never retry mutations automatically. Task tokens stay in
memory/sessionStorage, never URLs, cookies, analytics, logs or rendered markup.

| Site suffix under `/api/mcp/` | Backend under `/public/v1/playground/` | Limit per client key |
| --- | --- | --- |
| `query` | `POST query` | 60/min |
| `snapshot` | `POST analyze-snapshot` | 10/min |
| `change-review` | `POST review-change` | 10/min |
| `verification` | `POST verify-change` | 10/min |
| `upgrade` | `POST upgrade` | 10/min |
| `topology` | `POST topology` | 10/min |
| `expert/request` | `POST expert/request` | 3/day |
| `expert/status` | `POST expert/status` | 60/min |
| `feedback` | `POST feedback` | 60/min; contributions 3/day |

Schemas match corresponding public MCP tools. Limits protect public requests,
not pipeline executor capacity.

## Statistics and failure

Unauthenticated `GET /public/v1/stats` is cacheable for 300 seconds: active release,
safe coverage/answer/publication totals, no-AI ratio, latest 250-case eval
aggregate or null, and 30 daily growth/lab points. It omits questions, tenants,
IPs, private source/provenance data, backlog and researcher errors.

On backend failure, keep the page renderable with the last cached statistics,
mark staleness and disable the playground with an unavailable message.
