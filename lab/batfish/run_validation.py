#!/usr/bin/env python3
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pybatfish.client.session import Session
from pybatfish.datamodel import HeaderConstraints


root = Path(__file__).resolve().parents[2]
output = Path(os.environ.get("BATFISH_RESULT", root / "lab/results/batfish.json"))
now = datetime.now(timezone.utc)
bf = Session(host=os.environ.get("BATFISH_HOST", "127.0.0.1"))
bf.set_network("clideck-mcp-ci")

parse_checks = []
for name in ("base", "candidate"):
    snapshot_path = root / "lab/batfish" / name
    bf.init_snapshot(str(snapshot_path), name=name, overwrite=True)
    frame = bf.q.fileParseStatus().answer(snapshot=name).frame()
    statuses = sorted({str(value).upper() for value in frame["Status"].tolist()})
    passed = bool(statuses) and all("PASSED" in status for status in statuses)
    parse_checks.append({
        "check_type": "batfish_parse",
        "status": "passed" if passed else "failed",
        "summary": f"Batfish parsed the {name} Cisco configuration snapshot."
        if passed else f"Batfish could not fully parse the {name} snapshot.",
        "details": {"snapshot": name, "statuses": statuses},
    })

differential = bf.q.differentialReachability(
    headers=HeaderConstraints(
        srcIps="10.10.10.0/24",
        dstIps="10.20.20.0/24",
    )
).answer(snapshot="candidate", reference_snapshot="base").frame()
diff_passed = differential.empty
checks = parse_checks + [{
    "check_type": "batfish_differential_reachability",
    "status": "passed" if diff_passed else "failed",
    "summary": "The description-only candidate preserves modeled reachability."
    if diff_passed else "Batfish found an unexpected reachability difference.",
    "details": {"changed_flows": int(len(differential.index))},
}]

validation_passed = all(check["status"] == "passed" for check in checks)
stable_keys = [
    "cisco.ios-xe.show-ip-route",
    "cisco.ios-xe.change.interface-description",
]
validations = [{
    "stable_key": stable_key,
    "validation_type": "batfish_modeled",
    "fixture_key": "c9300-description-reachability",
    "tool_version": "batfish-2025.07.07.2423",
    "status": "passed" if validation_passed else "failed",
    "summary": (
        "Cisco syntax parsed and a bounded description-only change preserved "
        "modeled reachability in Batfish."
    ),
    "executed_at": now.isoformat().replace("+00:00", "Z"),
    "expires_at": (now + timedelta(days=90)).isoformat().replace("+00:00", "Z"),
    "details": {
        "model_scope": "Catalyst 9300",
        "runtime_image_tested": False,
        "modeled_only": True,
    },
} for stable_key in stable_keys]

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(
    json.dumps({"validations": validations, "checks": checks}, indent=2) + "\n",
    encoding="utf-8",
)
if not validation_passed:
    raise SystemExit(1)
