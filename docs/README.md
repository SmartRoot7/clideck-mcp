# Documentation map

Start with [AGENTS.md](../AGENTS.md). Load only the references needed for the
current task; do not preload every Markdown file or historical plan.
The hackathon freeze is lifted. This index was reviewed on 2026-11-08 against
repository code; dated production observations are not live status checks.

| Task | Read |
| --- | --- |
| Setup, commands, product overview | [README](../README.md) |
| Core, retrieval, releases, process boundaries | [Architecture](ARCHITECTURE.md) |
| Deploy, backup, recovery | [Operations](OPERATIONS.md) |
| Pipeline work or monitoring | [Corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md), then [Pipeline 2.0](KNOWLEDGE_PIPELINE_2.md) |
| Executors, model policy, Pause/Resume | [Researcher automation](RESEARCHER_AUTOMATION.md) |
| Admin capacity, model selection and prices | [Researcher automation](RESEARCHER_AUTOMATION.md) |
| Scheduler capacity rationale | [Capacity audit](PIPELINE_CAPACITY_AUDIT.md) |
| Auth, public projections, retention | [Security](SECURITY.md) |
| Domain Pack or fork | [Authoring](DOMAIN_PACK_AUTHORING.md), [fork guide](FORKING_WITH_CODEX.md) |
| Local operations console | [LAN admin](lan-admin-operations.md) |
| Browser evidence workspace | [WebMCP](WEBMCP.md) |
| Separate CliDeck website BFF | [Playground API](PLAYGROUND_API.md), [site handoff](SITE_INTEGRATION_HANDOFF.md), [metrics](ADMIN_PUBLISHED_METRICS_HANDOFF.md) |
| Data rights | [Data notice](../DATA-NOTICE.md) |

Architecture decision: [ADR 0001](adr/0001-modular-monolith.md).
Completed contest plans, submission scripts and superseded design assets were
removed in the [November 8 cleanup](PROJECT_CLEANUP_2026-11-08.md).
Use `git log -- <path>` for their earlier record.
