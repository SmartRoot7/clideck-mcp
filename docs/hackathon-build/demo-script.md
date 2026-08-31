# Network Evidence Workbench demo — target 2:40

## 0:00–0:25 — A real task, not a simulator

Open `/webmcp`. Explain that the workbench accepts real output and manuals but
does not connect to equipment or execute commands. Load the clearly labelled
Cisco-published Catalyst 9300 IOS XE 16.10 sample.

## 0:25–0:55 — Detect and ground

Click **Analyze evidence**. Show detected model, OS, version, selected evidence
window, local redaction disclosure, and incremented case version. Click
**Search knowledge**. Show that the closest EFSU guidance starts at IOS XE
17.3.2a, so the 16.10 case is visibly marked as nearest guidance rather than a
version match. No unrelated vendor result is mixed into the Cisco case.

## 0:55–1:25 — WebMCP collaboration

Enable **Share redacted evidence with browser agent** once. Ask the browser
agent to read the case, explain the official result, and propose next checks.
Show that its interpretation is visibly separate and citations are restricted
to the current result set.

## 1:25–1:55 — Revision-safe context switch

Load the Cisco-published IOS XE 17.8.1 sample while the same question remains.
Show the changed context and `case_version`, search again, and highlight the
explicit version-range match for Extended Fast Software Upgrade. A late
response from the prior case cannot overwrite this result.

## 1:55–2:20 — Bring a real document

Select a local text-layer PDF or LOG. Show page/line navigation, choose the
relevant window, and repeat analysis. Point out that complete files stay in
browser memory and only the selected redacted window is sent.

## 2:20–2:40 — Close the knowledge loop

Use a genuinely unanswered question. Show the real unknown result, click
**Research this gap**, and display the tracked lifecycle without promising an
instant answer. Close with: WebMCP gives the agent the same live, sourced case
the engineer sees, while CliDeck can grow when the answer is missing.
