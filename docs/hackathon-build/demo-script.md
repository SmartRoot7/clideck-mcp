# CliDeck WebMCP demo video — 60-second production script

## Format

- Target master duration: **0:59**. Devpost only requires an under-three-minute
  public YouTube demo with audio; there is no reason to fill the allowance.
- Master: 1920×1080, 30 fps, H.264 video, AAC audio.
- The English narration is a continuous product story. It never refers to a
  click, cursor, panel, or exact moment, so the edit can be fitted to the final
  voice track without sentence-level synchronization.
- Real production output supplies every product claim and result. Motion
  graphics only clarify the shipped WebMCP contract and case lifecycle.

## Creative direction

The recurring visual idea is:

> The wrong version is the wrong answer.

Keep the pace high: hard cuts, 1.5–3 second close crops, restrained cursor
pulses, and one smooth zoom per scene. Never wait on screen for a request to
finish; record the complete live operation, then cut from action to the real
completed state. Avoid fake chat bubbles and generic stock footage.

Use the existing CliDeck blue, white, near-black, green, and amber palette.
Keep important text inside the central 80% safe area. Show a small
**LIVE PRODUCT** tag whenever the public site is visible.

## Shot-by-shot plan

### 0:00–0:04 — Hook

Start on black with two fast lines:

> An answer can look right.

Replace it with:

> The wrong version is the wrong answer.

The word **version** resolves into the CliDeck case-version badge, followed by
the CliDeck mark.

### 0:04–0:13 — Evidence becomes a case

Cut to the real public page at https://mcp.clideck.com/webmcp, already reset.
In rapid close crops:

1. show “WebMCP connected · 6/6 tools”;
2. load the Cisco 16.10 sample;
3. select **Analyze evidence**;
4. reveal C9300 / Cisco IOS XE / 16.10.1, the explicit evidence window, and the
   local serial redaction count.

The sharing switch stays off. Highlight “Case v3” for less than one second.

### 0:13–0:23 — Honest applicability

Jump-cut from **Search knowledge** to the completed real result. Move through
three tight details:

- official CliDeck result and procedure;
- amber “Reference guidance · same software family · documented
  17.3.2a–latest”;
- official Cisco provenance and verification date.

Overlay one short caption:

> Plausible ≠ applicable

### 0:23–0:37 — The agent gets tools, not hidden access

Keep the live page behind a clean split-screen WebMCP trace:

1. “read_network_case” → “EVIDENCE_ACCESS_NOT_GRANTED”;
2. enable the real **Share redacted evidence with browser agent** switch;
3. “read_network_case” → bounded redacted evidence, Case v3;
4. “search_network_case” → current revision refs;
5. “present_network_case_analysis” → separate agent analysis.

Flash the six actual registered tool names as a compact capability rail:

“read · analyze · search · present · research · status”

Use the real case version and revision refs captured during the production
recording. This is a typed tool-call trace, not a fabricated conversation.

### 0:37–0:49 — Change the evidence, change the answer

Load the Cisco 17.8.1 sample, analyze, and search. Use three fast match cuts:

- evidence version 16.10.1 → 17.8.1;
- Case v3 → the new case version;
- amber reference guidance → green version-matched guidance.

Let the old result slide behind a thin boundary labelled:

> STALE RESULT REJECTED

This explains the shipped case-version rule without pretending that an error
occurred during the recording.

### 0:49–0:55 — Product proof

On a softened live-workbench background, land three proof statements in time
with the visual rhythm, not with particular spoken words:

> Selected evidence.
>
> Current case only.
>
> Verified sources.

### 0:55–0:59 — Close

End on:

> CliDeck MCP
>
> Human judgment. Agent speed. Verifiable answers.
>
> mcp.clideck.com/webmcp

Keep the repository URL in smaller text and leave one clean second at the end.

## Capture and edit plan

- Use a dedicated 1920×1080 browser window with personal tabs, bookmarks,
  notifications, and the desktop hidden.
- Capture the 16.10 and 17.8.1 operations as separate live takes. Keep normal
  request timing in the source takes, then cut only the dead wait between the
  action and completed state.
- Record close crops of the evidence, detected context, applicability badge,
  provenance, sharing control, and case-version badge. The full three-column
  page is an establishing shot, not the main reading view.
- Generate the intro, WebMCP trace, labels, and outro locally from the checked-in
  product palette and actual tool contracts.
- Use native macOS capture plus AVFoundation composition. No third-party video
  editor is required.
- Fit cut lengths and the final title-card hold to the delivered narration.
  The voice track remains untouched unless the participant asks for audio
  processing.
- Export below 1:00 when possible and always below 2:50. Watch the master once
  with sound and once muted; verify readability, factual accuracy, and absence
  of private UI.

## Contingencies

- If a live request is slow, keep the complete source take but jump-cut to its
  completed state in the edit.
- If a browser-agent presentation cannot be captured cleanly, render the
  schema-driven WebMCP trace with the real live case version and revision refs.
  Never invent a product response.
- If the final voice track exceeds 0:55, extend the master only to the exact
  track duration plus a two-second tail. Do not pad toward the three-minute
  limit.
