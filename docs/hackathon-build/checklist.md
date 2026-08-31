# Network Evidence Workbench build checklist

- [x] Replace the deterministic simulator, approval state, and lab execution
  tools with a real evidence workspace.
- [x] Add text and lazy PDF extraction, file/page/byte limits, local secret
  redaction, explicit line selection, and generic agent-facing labels.
- [x] Add monotonic case versions, abort propagation, stale-result rejection,
  reset cleanup, and a single evidence-sharing gate.
- [x] Register six stable WebMCP tools and keep all primary actions available as
  ordinary buttons.
- [x] Use the production knowledge, workflow, snapshot, research, and task MCP
  tools through a byte-bounded same-origin JSON-RPC client.
- [x] Add active-only safe provenance and metadata-only snapshot journaling.
- [x] Move research idempotency ahead of rate-limit consumption.
- [x] Add privacy, lifecycle, malformed citation, PDF, UTF-8 envelope, and
  manual-browser tests.
- [x] Update permanent product, demo, evaluation, and submission documentation;
  remove the temporary idea-research file.
- [x] Complete full check/test/eval/build, independent code/privacy review, and
  fix all material findings.
- [ ] Create one clean local `main` commit without pushing GitHub.
- [ ] Deploy only with `ops/scripts/deploy-production.sh` and verify health,
  public routes, manual flow, six-tool discovery, samples, PDF, reset, and
  research lifecycle.
- [ ] Prepare the public repository state and Devpost submission only after
  separate authorization.
