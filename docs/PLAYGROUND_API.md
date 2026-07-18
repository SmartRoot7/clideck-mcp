# Playground and statistics API

## Trust boundary

The browser never calls `mcp.clideck.com` directly. It calls explicit Next.js
Route Handlers under `clideck.com/api/mcp/*`. The site sends:

```text
Authorization: Bearer <CLIDECK_MCP_PLAYGROUND_TOKEN>
X-CliDeck-Client-Key: <base64url daily HMAC, 16-128 characters>
Content-Type: application/json
```

The BFF must not forward cookies, browser authorization, IP addresses, or other
headers. It must not log request or response bodies. The upstream URL is fixed
by configuration and is never accepted from a request.

## Public statistics

`GET /public/v1/stats` requires no bearer token and is cacheable for five
minutes. It returns:

- active release sequence and publication date;
- safe coverage totals;
- known answers, expert publications, and no-AI answer ratio;
- the actual latest 250-case eval aggregate, or `null`;
- 30 daily points for answers, new knowledge, and lab validations.

It never returns questions, tenants, IPs, task backlog, researcher errors,
provenance, source names, or source URLs.

## BFF-only operations

All request bodies are limited to 64 KiB and responses use `cache-control:
no-store`.

| Site route | Backend route | Limit |
| --- | --- | --- |
| `/api/mcp/query` | `POST /public/v1/playground/query` | 60/min |
| `/api/mcp/snapshot` | `POST /public/v1/playground/analyze-snapshot` | 10/min |
| `/api/mcp/change-review` | `POST /public/v1/playground/review-change` | 10/min |
| `/api/mcp/verification` | `POST /public/v1/playground/verify-change` | 10/min |
| `/api/mcp/upgrade` | `POST /public/v1/playground/upgrade` | 10/min |
| `/api/mcp/topology` | `POST /public/v1/playground/topology` | 10/min |
| `/api/mcp/expert/request` | `POST /public/v1/playground/expert/request` | 3/day |
| `/api/mcp/expert/status` | `POST /public/v1/playground/expert/status` | 60/min |
| `/api/mcp/feedback` | `POST /public/v1/playground/feedback` | 60/min; contributions 3/day |

Schemas are identical to the corresponding public MCP tool schemas. A task
access token stays only in memory or `sessionStorage`; it never appears in a URL,
cookie, log, analytics event, or server-rendered markup.

## Failure behavior

If the MCP backend is unavailable, the page remains renderable with the last
server-side cached statistics and disables the playground with “Playground
temporarily unavailable.” The BFF uses a 30-second timeout and does not retry
mutating operations automatically.
