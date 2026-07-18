# ADR 0001: Modular monolith with PostgreSQL

Status: accepted

CliDeck MCP uses one TypeScript codebase deployed as API, worker, and researcher
processes. PostgreSQL is the queue, immutable knowledge store, search engine, and
release coordinator.

This preserves transactional publication and operational simplicity while
keeping process privileges and network surfaces separate. Redis, a vector
database, and external LLM APIs are intentionally excluded.
