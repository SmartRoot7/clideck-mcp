#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Recompute this audit from recorded evidence, without network or DB writes."""
import csv
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def sections(name):
    return {row["section"]: row for row in read(name)["sections"]}


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def derive(monitor_name="monitor-final.json", recheck_name="recheck-final.json"):
    base = sections("baseline.json")
    deep = sections("deep-quality.json")
    usage = sections("usage-window.json")
    monitor = sections(monitor_name)
    cohort = read("questions.json")["selected"]
    final = {row["experiment_id"]: row for row in read(recheck_name)["results"]}
    demands = {row["question"]: row for row in monitor["demands"]["rows"]}
    result_rows = []
    for question in cohort:
        demand = demands[question["question"]]
        tasks = [row for row in monitor["tasks"]["rows"] if row["knowledge_demand_id"] == demand["id"]]
        diagnoses = [row for row in tasks if row["task_type"] == "demand_diagnosis"]
        diagnosis = diagnoses[0] if diagnoses else None
        recheck = final[question["experiment_id"]]
        result_rows.append({
            "experiment_id": question["experiment_id"], "group": question["group"],
            "question": question["question"], "baseline": question["baseline"]["answer_status"],
            "first_seen_at": demand["first_seen_at"], "checked_at": recheck["checked_at"],
            "observation_minutes": round((timestamp(recheck["checked_at"]) - timestamp(demand["first_seen_at"])).total_seconds() / 60, 3),
            "demand_status": demand["status"], "diagnosis_status": demand["diagnosis_status"],
            "diagnosis_task_exists": bool(diagnoses), "task_count": len(tasks),
            "diagnosis_seconds": round((timestamp(diagnosis["completed_at"]) - timestamp(demand["first_seen_at"])).total_seconds(), 3) if diagnosis and diagnosis["completed_at"] else None,
            "internal_replay": demand["replay_status"], "final_answer_status": recheck["answer_status"],
            "answer_count": len(recheck["answers"]),
        })
    fidelity = deep["active_fidelity"]["metrics"]
    public = base["public_quality"]["metrics"]
    prior = deep["demand_before_experiment"]["metrics"]
    qa = [row for row in base["qa"]["rows"] if row["stage"] == "extract_fidelity"]
    usage_metrics = usage["network_questions"]["metrics"]
    source_rows = monitor["sources"]["rows"]
    # A source's discovered_at precedes demand linkage when an old source is reused.
    newly_discovered = sum(timestamp(row["discovered_at"]) >= timestamp(demands[next(q for q, d in demands.items() if d["id"] == row["knowledge_demand_id"])]["first_seen_at"]) for row in source_rows)
    metrics = {
        "experiment": {
            "seed": read("questions.json")["seed"], "questions": len(cohort),
            "groups": dict(Counter(row["group"] for row in cohort)),
            "recorded_requests": len(monitor["requests"]["rows"]),
            "completed_diagnoses": sum(row["diagnosis_status"] == "completed" for row in result_rows),
            "without_diagnosis_task": sum(not row["diagnosis_task_exists"] for row in result_rows),
            "correct_new_answers_observed": sum(row["final_answer_status"] == "complete" and row["answer_count"] > 0 for row in result_rows),
            "final_statuses": dict(Counter(row["final_answer_status"] for row in result_rows)),
            "observation_min_minutes": min(row["observation_minutes"] for row in result_rows),
            "observation_max_minutes": max(row["observation_minutes"] for row in result_rows),
            "demand_states": dict(Counter(row["demand_status"] for row in result_rows)),
            "tasks": len(monitor["tasks"]["rows"]),
            "task_states": dict(Counter(row["status"] for row in monitor["tasks"]["rows"])),
            "agent_runs": len(monitor["agent_runs"]["rows"]),
            "agent_run_states": dict(Counter(row["status"] for row in monitor["agent_runs"]["rows"])),
            "sources_linked": len(source_rows), "sources_newly_discovered": newly_discovered,
            "sources_reused": len(source_rows) - newly_discovered,
        },
        "quality": {
            "active": base["volume"]["active"], "public": public["records"],
            "no_provenance": base["provenance"]["metrics"]["no_source"],
            "no_provenance_pct": round(100 * base["provenance"]["metrics"]["no_source"] / base["volume"]["active"], 4),
            "fidelity_candidate_backed": fidelity["has_candidate"], "fidelity_passed": fidelity["passed"],
            "fidelity_passed_pct": round(100 * fidelity["passed"] / fidelity["has_candidate"], 4),
            "historic_fidelity_checks": sum(row["n"] for row in qa),
            "historic_fidelity_material_errors": sum(row["n"] for row in qa if row["material_error"]),
            "historic_fidelity_material_error_pct": round(100 * sum(row["n"] for row in qa if row["material_error"]) / sum(row["n"] for row in qa), 4),
            "duplicate_extra_rows": base["duplicates"]["extra_rows"],
            "duplicate_extra_pct_of_commands": round(100 * base["duplicates"]["extra_rows"] / public["commands"], 4),
        },
        "usage": {
            **usage_metrics,
            "complete_label_pct": round(100 * usage_metrics["complete"] / usage_metrics["calls"], 4),
            "active_items_served": usage["served_active_items"]["metrics"]["active_items_served"],
            "active_items_served_pct": round(100 * usage["served_active_items"]["metrics"]["active_items_served"] / base["volume"]["active"], 4),
            "smoke_fixture_matches": usage["smoke_fixture_matches"]["metrics"]["calls_matching_syslog_smoke"],
            "historic_demands": prior["total"], "historic_replay_complete": prior["replay_complete"],
            "historic_replay_complete_pct": round(100 * prior["replay_complete"] / prior["total"], 4),
        },
    }
    assert len(result_rows) == 20 and len(demands) == 20
    assert all(row["baseline"] == "unknown" for row in result_rows)
    assert sum(usage_metrics[key] for key in ("complete", "partial", "unknown")) == usage_metrics["calls"]
    return metrics, result_rows


def sample_checks():
    samples = sections("deep-quality.json")["source_fidelity_sample"]["rows"]
    windows = {row["public_ref"]: row for row in read("sample-windows.json")}
    normalize = lambda value: re.sub(r"\s+", " ", value or "").strip().lower()
    findings = {
        4: "Описание про stacking Catalyst 2960-S не объясняет no boot config-file.",
        9: "Описание обрезано до 'form of this command.' и не объясняет команду.",
        23: "Заголовок страницы и таблицы опубликован как команда; окно содержит show switch bluetooth.",
    }
    return [{
        "sample_number": index, "public_ref": row["public_ref"], "title": row["title"],
        "command_text": row["command_text"], "summary": row["summary"],
        "canonical_url": row["canonical_url"],
        "command_literal_in_window": normalize(row["command_text"]) in normalize(windows[row["public_ref"]]["content"]) if row["command_text"] else None,
        "evidence_literal_in_window": normalize(row["evidence_fragment"]) in normalize(windows[row["public_ref"]]["content"]) if row["evidence_fragment"] else None,
        "manual_defect": findings.get(index),
    } for index, row in enumerate(samples, 1)]


def write_outputs():
    metrics, rows = derive()
    (ROOT / "derived.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "sample-checks.json").write_text(json.dumps({"method": "Whitespace-normalized literal containment is a citation diagnostic, not a factual accuracy score. Manual defects are examples from this sample, not a corpus error estimate.", "rows": sample_checks()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (ROOT / "experiment-results.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n"); writer.writeheader(); writer.writerows(rows)
    closing, closing_rows = derive("monitor-closing.json", "recheck-closing.json")
    (ROOT / "derived-closing.json").write_text(json.dumps(closing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (ROOT / "experiment-results-closing.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(closing_rows[0]), lineterminator="\n"); writer.writeheader(); writer.writerows(closing_rows)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    write_outputs()
