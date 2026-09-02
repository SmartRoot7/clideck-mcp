# CliDeck MCP — Network Evidence Workbench

## One-line Summary

Turn real network evidence into version-aware, source-backed answers that a
person and a WebMCP agent can inspect together without giving the agent hidden
access to the complete file.

## Problem

Network engineers regularly work from device output, configurations, logs, and
vendor manuals. A general-purpose agent can reason about that material, but it
may rely on stale command knowledge, mix guidance from the wrong platform, or
lose the exact device and software context as the investigation changes.

Copying an entire configuration or manual into a chat is also a poor control
boundary. The engineer needs to decide which evidence is shared, see what was
redacted, and distinguish verified product results from the agent's own
interpretation.

## Solution

CliDeck's Network Evidence Workbench gives the engineer and browser agent one
revision-safe case workspace. The engineer supplies a question and real device
evidence, chooses the exact line or PDF-page window, and reviews local redaction
before anything leaves the browser. CliDeck detects the device context and
searches its active, version-aware network knowledge and operational workflows.

The browser agent discovers six narrowly scoped WebMCP tools for the same live
case. It can analyze the selected evidence, search CliDeck, explain only the
current sourced results, and track a real research task when the answer is
unknown. Agent interpretation is visibly separated from official CliDeck
results, and stale responses cannot overwrite a newer case.

The page never connects to a network device and never executes commands.

## Why This Matters

This is a concrete example of a web application becoming better when people and
agents use it together. The engineer keeps the controls that require judgment:
which evidence to share, which context is correct, and whether a result is
applicable. The agent gets a typed, current capability surface instead of
guessing from pixels or asking the user to copy data back and forth.

For network operations, the difference is material. An answer for Cisco IOS XE
16.10 must not silently become an answer for NX-OS or for a newer release. The
workbench carries model, operating-system, version, result revision, provenance,
and case version through the interaction so that the collaboration remains
inspectable.

## How We Used AI

The browser agent uses WebMCP to reason over the current case and place a
bounded interpretation beside CliDeck's deterministic results. The agent does
not become the source of truth and does not receive the selected evidence until
the person enables one explicit sharing control.

CliDeck's production knowledge-growth pipeline also uses isolated GPT-5.6 Luna
runs for work that requires semantic judgment: discovering official material,
analyzing ambiguous fragments, independent verification, and deep review. The
deterministic core—not the model—enforces schemas, applicability, provenance,
risk rules, conflict handling, quality thresholds, and immutable publication.
Once published, a known answer is returned without a model call.

## How We Used Codex

Codex was the primary engineering environment and collaborator throughout the
project. During the challenge it helped replace an early artificial simulator
with the real Network Evidence Workbench, design the WebMCP lifecycle, implement
the React and TypeScript surface, add local text/PDF processing and redaction,
connect the workbench to production MCP services, and build the evaluation and
deployment workflow.

Codex also helped find and correct material boundary defects before release,
including over-wide evidence exposure, incomplete structured-secret redaction,
stale async updates, missing production grants, and cross-platform retrieval
mixing. The final release was exercised against unit, integration, privacy,
security, WebMCP lifecycle, product-evaluation, production smoke, and browser
tests.

## Key Features

- Six stable WebMCP tools: `read_network_case`, `analyze_network_case`,
  `search_network_case`, `present_network_case_analysis`,
  `start_case_research`, and `get_case_research_status`.
- A complete manual experience through ordinary controls when WebMCP is not
  available.
- TXT, LOG, MD, CSV, JSON, JSONL, HTML, and text-layer PDF input with explicit
  file, page, line-window, and byte limits.
- Local secret redaction before network requests, with a visible disclosure of
  the operational identifiers intentionally retained as diagnostic context.
- A monotonically increasing `case_version`, request cancellation, and
  stale-result rejection across parsing, analysis, search, presentation, and
  research polling.
- Version-aware knowledge and workflow retrieval with active-revision source
  metadata and honest nearest-version or cross-platform warnings.
- A separate agent-analysis block whose citations are limited to the current
  result set.
- Real tracked expert research for genuinely unknown questions, with
  idempotency and no task credential exposed to the browser agent.

## Architecture

The public React/Vite application is served at `/webmcp`. Complete files and
raw extracted text stay in browser memory. Only the explicit, locally redacted
evidence window is sent through a byte-bounded same-origin JSON-RPC client to
CliDeck's public MCP endpoint.

The six WebMCP tools are registered with `document.modelContext.registerTool`.
Their React lifecycle carries WebMCP's `AbortSignal` into the same-origin MCP
request and aborts registrations on unmount. The backend is TypeScript/Hono with
PostgreSQL for immutable knowledge revisions, applicability, provenance,
workflow retrieval, research tasks, audit, and publication state.

## Testing Instructions

1. Open https://mcp.clideck.com/webmcp in ChatGPT's in-app browser, or in a
   WebMCP-enabled Google Chrome browser.
2. Click **Load Cisco 16.10 sample**, then **Analyze evidence**.
3. Confirm that the detected context is Catalyst 9300 / IOS XE / 16.10 and the
   case version increases.
4. Click **Search knowledge**. The closest EFSU guidance should be labelled as
   nearest guidance rather than an exact version match.
5. Enable **Share redacted evidence with browser agent** and ask the agent to
   read the case and explain the current result. Its text should appear in the
   separate Browser agent analysis section.
6. Click **Load Cisco 17.8.1 sample**, analyze, and search again. Confirm that
   the case version changes and the EFSU result now shows an applicable version
   range.
7. Optionally upload a safe text-layer PDF or LOG, select a page/line window,
   and repeat the flow. Complete files remain local to the browser session.
8. Ask a genuinely unanswered question and use **Research this gap** to see the
   real tracked research lifecycle.
9. Click **Reset** and confirm that evidence, results, analysis, polling, and
   local file references are cleared.

No credentials are required for the public demo.

## Public Demo Link

https://mcp.clideck.com/webmcp

## Public Repository Link

https://github.com/SmartRoot7/clideck-mcp

The repository is public and includes a visible Apache-2.0 license, all source
code, test suites, deployment scripts, and judge walkthrough instructions.
Production knowledge and third-party manuals are intentionally not bundled.

## Demo Video

https://youtu.be/O5nXMNo9o20

Public YouTube demo with audio, under three minutes.

Production sequence (target 0:59):

1. Open with the risk: a plausible answer for the wrong software version is
   still the wrong answer.
2. Establish the live product and its six connected WebMCP tools.
3. Load and analyze the IOS XE 16.10 sample, including local redaction and the
   explicit evidence window.
4. Show active provenance and clearly labelled nearest-version guidance.
5. Visualize the browser agent's typed WebMCP exchange, explicit evidence
   consent, and separately presented interpretation.
6. Switch to IOS XE 17.8.1 and show the revision-safe, version-matched result.
7. Close on selected evidence, current-case isolation, and verified sources.

The narration is a continuous product explanation with no references to
individual clicks or exact on-screen moments. This lets the final edit fit the
delivered voice track without brittle synchronization.

## Screenshot Shot List

- Hero and populated Network case after loading the IOS XE 16.10 sample.
- Detected context plus nearest-version official CliDeck result and provenance.
- Browser agent analysis visibly separated from official results.
- IOS XE 17.8.1 version-matched result after the case-version change.
- Text-layer PDF/LOG page or line selection with local redaction disclosure.
- Unknown result with tracked research status.

## Submission Readiness Notes

- Live public application: ready.
- Public source repository: ready.
- Apache-2.0 license: ready and visible on GitHub.
- Product description and judge walkthrough: ready.
- WebMCP/manual automated coverage: ready.
- Final WebMCP-enabled Chrome walkthrough: ready; production reported
  `WebMCP connected · 6/6 tools` and the version-matched IOS XE 17.8.1 flow
  completed successfully.
- Devpost project fields: saved, including the public video URL.
- Devpost thumbnail: uploaded and processed from the verified production app.
- Public demo video URL: ready and published.
- Final Devpost submission: published and verified at
  https://devpost.com/software/clideck-mcp-network-evidence-workbench.

## Known Limitations

- The workbench does not connect to network devices and does not execute
  commands.
- OCR, encrypted PDFs, and image-only PDFs are not supported; PDF input must
  contain a text layer.
- Network knowledge is deepest for Cisco Catalyst and IOS XE. The product
  returns a limitation or `unknown` rather than inventing unsupported guidance.
- Operational IP, MAC, hostname, and username values are retained as diagnostic
  context and clearly disclosed; secrets and serial-like values are redacted.
- Starting a research task does not promise an immediate published answer.

## TODO Official Form Fields

- **Submitter Type:** Individual
- **Country of residence:** United States (participant resides in Illinois).
- **Organization name:** Not applicable.
- **App Status:** Existing
- **What was updated during the submission period:** CliDeck's production
  knowledge system and public MCP existed before the challenge. During the
  submission period we created the separate Network Evidence Workbench at
  `/webmcp`, six browser-native WebMCP tools, local text/PDF extraction and
  redaction, revision-safe case lifecycle, active provenance display, tracked
  unknown-question research, judge walkthroughs, and WebMCP/privacy tests.
- **Live URL:** https://mcp.clideck.com/webmcp
- **Testing instructions / credentials:** Use the Testing Instructions above;
  no credentials are required.
- **Public code repository:** https://github.com/SmartRoot7/clideck-mcp
- **Agents or clients tested:** Google Chrome with WebMCP testing enabled
  (`6/6` registered tools verified); the complete manual fallback was also
  tested in standard Chrome.
- **AI tools leveraged:** Codex, GPT-5.6, and GPT-5.6 Luna. Codex was the primary
  engineering environment; GPT-5.6 Luna powers bounded semantic stages in the
  production knowledge-growth pipeline.
- **Level of learning:** Significant
- **AI value useful in career:** Yes
- **Video URL:** https://youtu.be/O5nXMNo9o20
