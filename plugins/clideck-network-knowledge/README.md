# CliDeck Network Knowledge plugin

This directory contains the portable MCP-only plugin package for the OpenAI
plugin directory. It connects to the existing public service without requiring
an API key. The selected icon is option 01 from the September 30 icon review.

The OpenAI draft is owned by CLIDECK LLC. Its metadata and five positive/three
negative review scenarios are in `plugin.json`; the remote server is in
`mcp.json`. The package does not include skills or an embedded UI.

Build an upload ZIP from the repository root:

```sh
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path('plugins/clideck-network-knowledge')
target = Path('artifacts/publication/clideck-network-knowledge-0.1.0.zip')
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in ('plugin.json', 'mcp.json', 'assets/icon.png'):
        archive.write(root / name, name)
print(target.resolve())
PY
```

Before submitting, verify the associated domain, rescan the deployed MCP
definitions, run the scenarios through an OpenAI client, and add a recording
of those scenarios to `extensions.com.openai.review.demo_recording_url`.
Existing product marketing and WebMCP videos are supplementary material; they
do not demonstrate this complete plugin review suite. Review the public
privacy policy against actual MCP processing and retention before submission.

The MCP annotations distinguish advisory tools that create or update research
demands from tools that only read or analyze data. No tool applies commands to
network equipment. Routine sanitized telemetry does not make a read operation
a user-facing mutation.

References: [packaging](https://developers.openai.com/plugins/build/plugins),
[submission](https://developers.openai.com/plugins/deploy/submission).
