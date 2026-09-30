# Documentation map

Start with [AGENTS.md](../AGENTS.md). Load only the references needed for the
current task; do not preload every Markdown file or historical plan.
The hackathon freeze is lifted. This index was reviewed on 2026-09-29 against
repository code; dated production observations are not live status checks.

| Task | Read |
| --- | --- |
| Setup, commands, product overview | [README](../README.md) |
| Core, retrieval, releases, process boundaries | [Architecture](ARCHITECTURE.md) |
| Deploy, backup, recovery | [Operations](OPERATIONS.md) |
| Pipeline work or monitoring | [Corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md), then [Pipeline 2.0](KNOWLEDGE_PIPELINE_2.md) |
| Executors, model policy, Pause/Resume | [Researcher automation](RESEARCHER_AUTOMATION.md) |
| Planned admin capacity and model selection | [Execution settings plan](PIPELINE_EXECUTION_SETTINGS_PLAN.md) |
| Scheduler capacity rationale | [Capacity audit](PIPELINE_CAPACITY_AUDIT.md) |
| Auth, public projections, retention | [Security](SECURITY.md) |
| Domain Pack or fork | [Authoring](DOMAIN_PACK_AUTHORING.md), [fork guide](FORKING_WITH_CODEX.md) |
| Local operations console | [LAN admin](lan-admin-operations.md) |
| Browser evidence workspace | [WebMCP](WEBMCP.md) |
| Separate CliDeck website BFF | [Playground API](PLAYGROUND_API.md), [site handoff](SITE_INTEGRATION_HANDOFF.md), [metrics](ADMIN_PUBLISHED_METRICS_HANDOFF.md) |
| Data rights | [Data notice](../DATA-NOTICE.md) |

Historical references: [Build Week](BUILD_WEEK_EXECUTION_PLAN.md),
[0.8 modernization](MCP_0_8_MODERNIZATION_PLAN.md),
[hackathon notes](hackathon-build/build-notes.md),
[submission](../devpost-submission.md), [ADR 0001](adr/0001-modular-monolith.md).
They do not authorize deployment, external submissions or cross-repository work.
Use `git log -- <path>` for the detailed earlier record.
