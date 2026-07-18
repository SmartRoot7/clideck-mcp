# CliDeck site integration handoff

Work only in the main CliDeck website repository. Do not change `clideck-mcp`.

Add the free product **CliDeck MCP — Network Knowledge** at
`https://clideck.com/software/mcp`, in the existing site design, and link it from
Products, the Software index, the homepage product family, sitemap, and SEO
metadata.

The English page needs:

- a hero with “Connect MCP” and “Try Playground”;
- endpoint `https://mcp.clideck.com/mcp`;
- deterministic, version-aware knowledge and no AI in the read path;
- live aggregate counters, actual latest eval result, and a lightweight 30-day
  SVG growth chart;
- `unknown → Codex → validate → publish → instant reuse`;
- tabs: Ask, Detect Device, Review Change, Verify, Upgrade, Topology;
- topology/path graph visualization;
- MCP-client connection instructions;
- coverage, trust/privacy, limitations, and FAQ.

Use explicit Next.js Route Handlers under `/api/mcp/*`. The upstream comes only
from `CLIDECK_MCP_BACKEND_URL`; authorization comes only from
`CLIDECK_MCP_PLAYGROUND_TOKEN`. Follow the exact backend mapping in
`docs/PLAYGROUND_API.md`.

Security requirements:

- no generic/open proxy;
- body limit 64 KiB and timeout 30 seconds;
- `cache: no-store` for interactive operations;
- never forward cookies or browser `Authorization`;
- never log bodies, CLI, config diffs, snapshots, or task tokens;
- send only a daily HMAC client key, not the user IP;
- keep task tokens in memory/`sessionStorage`, never URL/cookie;
- server-side stats use `GET /public/v1/stats` with 300-second revalidation;
- when unavailable, keep the page online with cached stats and disable inputs.

Use the existing graph component or `@xyflow/react`; keep statistics charts as
light SVG. Add responsive, accessibility, component, and Playwright coverage.

Do not expose internal sources, manual names, source URLs, or claim full vendor
support. Exact launch wording:

> Deep support for Cisco Catalyst 9300 / IOS-XE. Junos and Arista EOS device
> detection is available with limited knowledge coverage.

Run the production build and deployment, then return the production URL, commit
SHA, and test results.
