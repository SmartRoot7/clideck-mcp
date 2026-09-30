# ADR 0001: Modular monolith with PostgreSQL

Accepted. One TypeScript codebase provides API, worker, researcher and admin
processes. PostgreSQL owns queue, immutable knowledge, search and releases.
Transactional publication stays simple while process privileges/network surfaces
remain separate. Redis, vectors and external model APIs are not required.
See [Architecture](../ARCHITECTURE.md).
