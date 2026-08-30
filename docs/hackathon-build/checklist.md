# Build checklist

Mode: autonomous. Verification pauses: final browser QA. Git cadence: one local
commit after all checks. Wow moment: the execution tool appears only after a
visible human approval and then produces signed verification.

- [x] **1. Deterministic lab state**
  Spec ref: `spec.md > State and tools`
  What to build: Pure reducer, snapshots, allowed command sequence and atomic validation.
  Acceptance: No unsupported or reordered command can change lab state.
  Verify: Unit tests for all transitions and reset.

- [x] **2. Same-origin MCP bridge**
  Spec ref: `spec.md > Architecture`
  What to build: Typed JSON-RPC caller with timeout and safe error handling.
  Acceptance: Structured content is returned and protocol/application failures are distinct.
  Verify: Unit tests with mocked fetch responses.

- [x] **3. WebMCP tool lifecycle**
  Spec ref: `spec.md > State and tools`
  What to build: Five tools with bounded schemas, annotations and state guards.
  Acceptance: `run_lab_commands` is absent before approval and present afterwards.
  Verify: React lifecycle tests with a fake `document.modelContext`.

- [x] **4. Network Change Room page**
  Spec ref: `prd.md > Requirements`
  What to build: Separate responsive page using existing CliDeck visual tokens.
  Acceptance: Visible phase, device state, approval action, guidance, timeline and fallback.
  Verify: Desktop/mobile browser walkthrough and keyboard navigation.

- [x] **5. Public route and security header**
  Spec ref: `spec.md > Security and compatibility`
  What to build: Serve SPA at `/webmcp` and emit `Permissions-Policy: tools=(self)`.
  Acceptance: Existing routes and contracts are unchanged.
  Verify: API route and header tests.

- [x] **6. Documentation and evaluation**
  Spec ref: `prd.md > Success criteria`
  What to build: README challenge section, test prompts and pre-existing/new boundary.
  Acceptance: A judge can reproduce the complete demo without private credentials.
  Verify: README walkthrough and eval cases.

- [ ] **7. Full verification and production release**
  Spec ref: `prd.md > Success criteria`
  What to build: Run all checks, local commit, canonical deploy and production smoke.
  Acceptance: Health, ready, MCP, admin, demo and WebMCP all pass.
  Verify: `pnpm check`, `pnpm test`, `pnpm eval`, `pnpm build`, browser QA.

- [ ] **8. Devpost handoff**
  Spec ref: `prd.md > Success criteria`
  What to build: Submission draft and sub-three-minute narrated demo script.
  Acceptance: All required links and truthful new-vs-existing claims are ready.
  Verify: Submission readiness review; no push or submission without final authorization.
