#!/usr/bin/env python3
"""Merge worker-actions zizmor baseline with optional caller zizmor.yml.

Baseline supplies org-wide policies (e.g. unpinned-uses ref-pin for actions/*).
Caller file adds repo-specific ignores/rules; caller keys override baseline where
both define the same rule field (except ignore lists, which are unioned).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    raise SystemExit(2) from exc


def _load(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise SystemExit(f"{path}: root must be a mapping")
    return data


def _merge_rule(base: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in local.items():
        if key == "ignore":
            existing = list(out.get("ignore") or [])
            extra = list(value or [])
            out["ignore"] = list(dict.fromkeys(existing + extra))
        elif key == "config" and isinstance(value, dict):
            cfg = dict(out.get("config") or {})
            for ck, cv in value.items():
                if ck == "policies" and isinstance(cv, dict):
                    policies = dict(cfg.get("policies") or {})
                    policies.update(cv)
                    cfg["policies"] = policies
                else:
                    cfg[ck] = cv
            out["config"] = cfg
        else:
            out[key] = value
    return out


def merge_configs(baseline: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    if not local:
        return baseline
    out = dict(baseline)
    base_rules = dict(baseline.get("rules") or {})
    local_rules = dict(local.get("rules") or {})
    merged_rules = dict(base_rules)
    for rule_id, local_rule in local_rules.items():
        if rule_id not in merged_rules:
            merged_rules[rule_id] = local_rule
        elif isinstance(local_rule, dict) and isinstance(merged_rules[rule_id], dict):
            merged_rules[rule_id] = _merge_rule(merged_rules[rule_id], local_rule)
        else:
            merged_rules[rule_id] = local_rule
    out["rules"] = merged_rules
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="worker-actions zizmor.yml")
    parser.add_argument(
        "local",
        type=Path,
        nargs="?",
        help="caller zizmor.yml (optional)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="merged config path",
    )
    args = parser.parse_args()

    baseline = _load(args.baseline)
    local = _load(args.local) if args.local and args.local.is_file() else {}
    merged = merge_configs(baseline, local)
    args.output.write_text(
        yaml.safe_dump(merged, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
