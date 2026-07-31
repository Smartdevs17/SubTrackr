#!/usr/bin/env python3
"""Create a compact security findings dashboard from CI scanner JSON reports."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

CRITICAL = {"critical", "error"}
HIGH = {"high", "warning"}
SLA = {
    "Critical": "<24h",
    "High": "<72h",
    "Medium": "Next scheduled release",
    "Low": "Best effort",
    "Unknown": "Triage required",
}


def normalize_severity(value: Any) -> str:
    if isinstance(value, (int, float)):
        if value >= 9:
            return "Critical"
        if value >= 7:
            return "High"
        if value >= 4:
            return "Medium"
        return "Low"

    severity = str(value or "unknown").strip().lower()
    try:
        return normalize_severity(float(severity))
    except ValueError:
        pass

    if severity in CRITICAL:
        return "Critical"
    if severity in HIGH:
        return "High"
    if severity in {"medium", "moderate"}:
        return "Medium"
    if severity == "low":
        return "Low"
    return "Unknown"


def load_json(path: Path) -> dict[str, Any] | list[Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return {}


def parse_semgrep(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for result in data.get("results", []):
        extra = result.get("extra", {})
        findings.append(
            {
                "tool": "Semgrep",
                "severity": normalize_severity(extra.get("severity")),
                "target": result.get("path", "unknown"),
                "finding": result.get("check_id", "semgrep finding"),
                "guidance": extra.get("message", "Review the matched rule and apply a safe pattern."),
            }
        )
    return findings


def parse_npm_audit(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for name, vuln in data.get("vulnerabilities", {}).items():
        via = vuln.get("via", [])
        if isinstance(via, list):
            advisories = [
                item if isinstance(item, str) else item.get("title", item.get("source", name))
                for item in via
            ]
            finding = ", ".join(str(item) for item in advisories)
        else:
            finding = str(via or name)

        findings.append(
            {
                "tool": "npm audit",
                "severity": normalize_severity(vuln.get("severity")),
                "target": name,
                "finding": finding,
                "guidance": "Upgrade to the patched version or document a justified exception.",
            }
        )
    return findings


def parse_pip_audit(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for dep in data.get("dependencies", []):
        for vuln in dep.get("vulns", []):
            aliases = ", ".join(vuln.get("aliases", []))
            fixed = ", ".join(vuln.get("fix_versions", [])) or "no fixed version published"
            findings.append(
                {
                    "tool": "pip-audit",
                    "severity": normalize_severity(vuln.get("severity")),
                    "target": dep.get("name", "python dependency"),
                    "finding": aliases or vuln.get("id", "python advisory"),
                    "guidance": f"Upgrade to {fixed} or record an approved exception.",
                }
            )
    return findings


def parse_cargo_audit(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for vuln in data.get("vulnerabilities", {}).get("list", []):
        advisory = vuln.get("advisory", {})
        package = vuln.get("package", {})
        severity = advisory.get("severity") or advisory.get("cvss")
        findings.append(
            {
                "tool": "cargo audit",
                "severity": normalize_severity(severity),
                "target": package.get("name", "rust crate"),
                "finding": advisory.get("id", "rust advisory"),
                "guidance": advisory.get("description", "Upgrade the affected crate or document an exception."),
            }
        )
    return findings


def parse_trivy(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for result in data.get("Results", []):
        target = result.get("Target", "container")
        for vuln in result.get("Vulnerabilities", []):
            findings.append(
                {
                    "tool": "Trivy",
                    "severity": normalize_severity(vuln.get("Severity")),
                    "target": target,
                    "finding": vuln.get("VulnerabilityID", "container vulnerability"),
                    "guidance": vuln.get("FixedVersion") or vuln.get("Title") or "Update the base layer or package.",
                }
            )
        for misconfig in result.get("Misconfigurations", []):
            findings.append(
                {
                    "tool": "Trivy config",
                    "severity": normalize_severity(misconfig.get("Severity")),
                    "target": target,
                    "finding": misconfig.get("ID", "configuration issue"),
                    "guidance": misconfig.get("Resolution") or misconfig.get("Message") or "Harden the configuration.",
                }
            )
    return findings


def parse_snyk(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    findings = []
    projects = data if isinstance(data, list) else [data]
    for project in projects:
        if not isinstance(project, dict):
            continue
        for vuln in project.get("vulnerabilities", []):
            findings.append(
                {
                    "tool": "Snyk",
                    "severity": normalize_severity(vuln.get("severity")),
                    "target": vuln.get("packageName", vuln.get("name", "dependency")),
                    "finding": vuln.get("id", vuln.get("title", "snyk vulnerability")),
                    "guidance": vuln.get("upgradePath")
                    or vuln.get("fixedIn")
                    or "Upgrade, patch, or record an approved Snyk exception.",
                }
            )
    return findings


def parse_zap(path: Path) -> list[dict[str, str]]:
    data = load_json(path)
    if not isinstance(data, dict):
        return []
    findings = []
    for site in data.get("site", []):
        target = site.get("@name", "ZAP target")
        for alert in site.get("alerts", []):
            risk = str(alert.get("riskdesc", alert.get("riskcode", "unknown"))).split()[0]
            findings.append(
                {
                    "tool": "OWASP ZAP",
                    "severity": normalize_severity(risk),
                    "target": target,
                    "finding": alert.get("name", "DAST alert"),
                    "guidance": alert.get("solution", "Review the affected endpoint and apply OWASP guidance."),
                }
            )
    return findings


def collect_findings(report_dir: Path) -> list[dict[str, str]]:
    parsers = [
        ("semgrep", parse_semgrep),
        ("npm-audit", parse_npm_audit),
        ("pip-audit", parse_pip_audit),
        ("cargo-audit", parse_cargo_audit),
        ("trivy", parse_trivy),
        ("snyk", parse_snyk),
        ("zap", parse_zap),
    ]
    findings: list[dict[str, str]] = []
    for path in sorted(report_dir.rglob("*.json")):
        for marker, parser in parsers:
            if marker in path.name:
                findings.extend(parser(path))
                break
    return findings


def build_markdown(findings: list[dict[str, str]]) -> str:
    counts = {severity: 0 for severity in SLA}
    for finding in findings:
        counts[finding["severity"]] = counts.get(finding["severity"], 0) + 1

    lines = [
        "# Security Dashboard",
        "",
        "| Severity | Count | SLA | Merge policy |",
        "| --- | ---: | --- | --- |",
    ]
    for severity in ["Critical", "High", "Medium", "Low", "Unknown"]:
        policy = "Blocks merge" if severity == "Critical" else "Security review / triage"
        lines.append(f"| {severity} | {counts.get(severity, 0)} | {SLA[severity]} | {policy} |")

    lines.extend(["", "## Findings", ""])
    if not findings:
        lines.append("No scanner findings were present in the uploaded JSON reports.")
        return "\n".join(lines) + "\n"

    lines.extend(
        [
            "| Tool | Severity | Age | Target | Finding | Fix guidance | SLA |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for finding in findings:
        severity = finding["severity"]
        lines.append(
            "| {tool} | {severity} | New in this scan | {target} | {finding} | {guidance} | {sla} |".format(
                tool=finding["tool"],
                severity=severity,
                target=finding["target"].replace("|", "\\|"),
                finding=finding["finding"].replace("|", "\\|"),
                guidance=finding["guidance"].replace("\n", " ").replace("|", "\\|")[:220],
                sla=SLA.get(severity, SLA["Unknown"]),
            )
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report_dir", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--tool", default="security")
    parser.add_argument("--fail-on-critical", action="store_true")
    args = parser.parse_args()

    findings = collect_findings(args.report_dir)
    markdown = build_markdown(findings)
    if args.output:
        args.output.write_text(markdown, encoding="utf-8")
    else:
        print(markdown)

    high_count = sum(1 for finding in findings if finding["severity"] == "High")
    critical_count = sum(1 for finding in findings if finding["severity"] == "Critical")
    if high_count:
        print(f"::warning::{high_count} high-severity {args.tool} finding(s) require security-team review.")
    if args.fail_on_critical and critical_count:
        print(f"::error::{critical_count} critical {args.tool} finding(s) block merge.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
