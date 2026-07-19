# Data and licensing notice

CliDeck MCP separates software licensing from knowledge-data rights.

## Included under Apache-2.0

The repository's Apache-2.0 license applies to:

- source code;
- migrations, schemas, and tests;
- Domain Pack templates;
- project-authored Network seed fixtures;
- the 16 project-authored Engineering Measurements sample records;
- documentation written for this project.

## Not included

The repository does not distribute:

- the production CliDeck knowledge database;
- downloaded manuals or complete source documents;
- private, authenticated, or closed documents;
- user questions, CLI logs, snapshots, or opted-in quarantine data;
- production provenance records;
- database backups, credentials, tokens, or operational audit records.

The public service returns original structured facts and procedures through an
allowlisted response contract. It does not return source URLs, manual titles,
quotations, evidence fragments, or internal provenance identifiers.

## Responsibilities of fork operators

A fork operator is responsible for confirming that they are permitted to
acquire, process, store, and publish the data they choose. Hiding a source does
not create permission to use it.

Keep third-party rights and retention policies separate from the Apache-2.0
software license. Put credentials in server-owned environment files, never in
Git, prompts, fixtures, pack manifests, or knowledge payloads.

For public fixtures, use project-authored, public-domain, or explicitly licensed
material and record that status in the pack README.

## Provenance

Core requires minimal internal provenance so an operator can audit why a
revision was accepted. Provenance is restricted operational data, not a public
MCP response and not part of the open-source dataset.
