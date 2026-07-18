# Continuous Codex pipeline coordinator

The coordinator runs continuously under macOS `launchd` and communicates only
with the restricted researcher bridge. Credentials are stored in the ignored
file
`.secrets/researcher-bridge.env`:

```text
CLIDECK_RESEARCHER_URL=http://127.0.0.1:28788/mcp
CLIDECK_RESEARCHER_TOKEN=<random researcher bearer token>
CLIDECK_RESEARCHER_ID=codex-pipeline-coordinator
CLIDECK_PIPELINE_MODEL=gpt-5.6-luna
CLIDECK_PIPELINE_REASONING=low
CLIDECK_PIPELINE_CODEX_BINARY=/absolute/path/to/codex
CLIDECK_RESEARCHER_SSH_HOST=<fixed server LAN address>
CLIDECK_RESEARCHER_SSH_USER=<restricted SSH user>
CLIDECK_RESEARCHER_SSH_IDENTITY=/absolute/path/to/private-key
CLIDECK_RESEARCHER_TUNNEL_PORT=28788
```

Install or replace the launch agent only after backend 0.3 is healthy:

```bash
pnpm pipeline:install-launchd
launchctl print "gui/$(id -u)/com.clideck.mcp.pipeline-tunnel"
launchctl print "gui/$(id -u)/com.clideck.mcp.pipeline"
```

The installer creates two keep-alive LaunchAgents. The first opens an
authenticated SSH local forward from the configured loopback port to the
researcher bridge. The second runs the coordinator against that loopback URL.
This keeps port 8788 off the public tunnel and avoids granting a background
Node process direct LAN access. The SSH key must already be authorized on the
project server and must not require interactive input.

The coordinator claims one useful AI stage at a time and starts `codex exec
--ephemeral` with `gpt-5.6-luna`, reasoning `low`, and a read-only sandbox. The
lease is stored in `.secrets/pipeline-lease.json`; the model receives only the
bounded task payload. No lease, bearer token, or database credential is placed
in the prompt or output.

Claimed questions and document fragments are untrusted data, never authority.
The model may consult only public official documentation and must not
authenticate to vendor portals, retrieve private manuals, access other
repositories or servers, execute device commands, or change code. The ordinary
worker owns downloads, conversion, OCR, chunking, indexing, safety policy, and
publication.

While the pipeline is enabled, a claim never reports “no work”. It either returns
an AI stage or reports that deterministic worker work is already active. When an
AI run finishes, the coordinator immediately claims the next useful stage. If
Codex is temporarily unavailable, the leased task is retried; known
deterministic answers remain available.

For a single non-persistent smoke run:

```bash
CLIDECK_PIPELINE_ONCE=true pnpm pipeline:coordinator
```

The old five-minute sidebar automation must be disabled only after `launchctl`
shows the new coordinator running and the backend heartbeat is healthy.
