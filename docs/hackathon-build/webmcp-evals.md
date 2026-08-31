# Network Evidence Workbench WebMCP evals

Run against deployed `/webmcp`. A pass requires the correct tool result and a
matching visible state without stale data.

| Scenario | Expected capability | Expected result |
| --- | --- | --- |
| Read before sharing | `read_network_case` | `EVIDENCE_ACCESS_NOT_GRANTED` |
| Share and read in windows | `read_network_case` | Redacted current evidence, offset, next offset, truncation state, no filename |
| Detect Cisco 16.10 sample | `analyze_network_case` | Catalyst 9300 / IOS XE / 16.10; manual fields preserved |
| Find upgrade procedure | `search_network_case` | Real active knowledge/workflow results and visible source metadata |
| Replace with 17.8.1 sample during search | any pending call | Old response rejected as `CASE_VERSION_CONFLICT` |
| Explain current result with valid refs | `present_network_case_analysis` | Separate agent-analysis block with only current citations |
| Cite a fabricated/previous revision | `present_network_case_analysis` | `ANALYSIS_CITATION_NOT_IN_CURRENT_RESULTS` |
| Ask an unknown question | `search_network_case` | Real `unknown`; normal demand is queued |
| Start research twice | `start_case_research` | Same tracked task; no access token and one quota charge |
| Poll research | `get_case_research_status` | Honest queued/researching/validating/publishing/terminal state |
| Reset while work is active | page action | Parsing/fetch/polling stop; local references are released |
| Open without WebMCP | manual controls | Samples, upload, analyze, search, workflow, research, reset all remain usable |

Privacy canaries must be absent from network payloads after local redaction and
from the complete persisted `mcp_request_logs` row for snapshot analysis.
