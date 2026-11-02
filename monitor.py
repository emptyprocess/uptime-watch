
import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

TIMEOUT = 12
WORKERS = 10
RETENTION_DAYS = 30


def utc_now():
    return datetime.now(timezone.utc)


def check(service):
    started = time.perf_counter()

    request = urllib.request.Request(
        service["url"],
        headers={
            "User-Agent": "UptimeWatch/1.0 (+GitHub Actions)",
            "Accept": "text/html,application/json,*/*",
        },
    )

    status = None
    error = None

    try:
        with urllib.request.urlopen(
            request, timeout=TIMEOUT
        ) as response:
            status = response.status

    except urllib.error.HTTPError as exc:
        status = exc.code
        error = str(exc)

    except Exception as exc:
        error = str(exc)[:300]

    latency = round(
        (time.perf_counter() - started) * 1000, 2
    )

    # Authentication and rate limits do not
    # necessarily mean the service is down.
    if status in (401, 403, 429):
        state = "unknown"

    elif status is not None and 200 <= status < 400:
        state = "up"

    else:
        state = "down"

    return {
        "id": service["id"],
        "name": service["name"],
        "category": service["category"],
        "url": service["url"],
        "status": state,
        "http_status": status,
        "latency_ms": latency,
        "error": error,
    }


def load_reports():
    cutoff = utc_now() - timedelta(
        days=RETENTION_DAYS
    )

    reports = []

    if not DATA.exists():
        return reports

    for path in sorted(DATA.glob("*/*.json")):
        try:
            report = json.loads(
                path.read_text(encoding="utf-8")
            )

            timestamp = datetime.fromisoformat(
                report["timestamp"].replace("Z", "+00:00")
            )

            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(
                    tzinfo=timezone.utc
                )

            if timestamp >= cutoff:
                reports.append(report)

        except (
            ValueError,
            TypeError,
            KeyError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            print(f"Skipping invalid report {path}: {exc}")

    reports.sort(
        key=lambda item: item["timestamp"]
    )

    return reports


def normalize_results(results, service_lookup):
    normalized = []

    if not isinstance(results, list):
        return normalized

    for result in results:
        if not isinstance(result, dict):
            continue

        # Current report format
        if "id" in result and "status" in result:
            service_id = result["id"]

            if service_id not in service_lookup:
                continue

            normalized.append(result)
            continue

        # Legacy report format:
        # {
        #   "service": "github",
        #   "status": 200,
        #   "up": true,
        #   "latency_ms": 120
        # }

        service_id = result.get("service")

        if not service_id:
            continue

        service = service_lookup.get(service_id)

        if not service:
            continue

        http_status = result.get("status")

        if http_status in (401, 403, 429):
            state = "unknown"

        elif result.get("up") is True:
            state = "up"

        else:
            state = "down"

        normalized.append({
            "id": service_id,
            "name": service["name"],
            "category": service["category"],
            "url": service["url"],
            "status": state,
            "http_status": http_status,
            "latency_ms": result.get(
                "latency_ms", 0
            ),
            "error": result.get("error"),
        })

    return normalized


def build_dashboard(reports, services):
    service_lookup = {
        service["id"]: service
        for service in services
    }

    valid_checks = []

    for report in reports:
        # New format uses "results".
        # Original format used "services".
        results = report.get("results")

        if results is None:
            results = report.get("services", [])

        normalized = normalize_results(
            results,
            service_lookup
        )

        if not normalized:
            print(
                "Skipping report without valid results:",
                report.get("timestamp", "unknown")
            )
            continue

        valid_checks.append({
            "timestamp": report["timestamp"],
            "results": normalized,
        })

    return {
        "generated_at": utc_now().isoformat(),
        "interval_minutes": 15,
        "services": services,
        "checks": valid_checks,
    }


def cleanup_old_reports(now):
    cutoff_date = (
        now - timedelta(days=RETENTION_DAYS)
    ).date()

    if not DATA.exists():
        return

    for folder in DATA.iterdir():
        if not folder.is_dir():
            continue

        try:
            folder_date = datetime.strptime(
                folder.name,
                "%Y-%m-%d"
            ).date()

        except ValueError:
            continue

        if folder_date >= cutoff_date:
            continue

        for old_file in folder.glob("*.json"):
            old_file.unlink()

        try:
            folder.rmdir()
        except OSError:
            pass


def main():
    config_path = ROOT / "services.json"

    if not config_path.exists():
        raise FileNotFoundError(
            "services.json not found"
        )

    config = json.loads(
        config_path.read_text(encoding="utf-8")
    )

    services = config["services"]

    if not services:
        raise ValueError(
            "No services configured in services.json"
        )

    print(
        f"Starting uptime checks for "
        f"{len(services)} services..."
    )

    # Check services concurrently.
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=WORKERS
    ) as executor:
        results = list(
            executor.map(check, services)
        )

    now = utc_now()

    # Save a unique JSON report for every run.
    day = DATA / now.strftime("%Y-%m-%d")
    day.mkdir(
        parents=True,
        exist_ok=True
    )

    run_id = os.environ.get(
        "GITHUB_RUN_ID", "local"
    )

    attempt = os.environ.get(
        "GITHUB_RUN_ATTEMPT", "1"
    )

    filename = (
        f"{now:%H-%M-%S-%f}-"
        f"{run_id}-{attempt}.json"
    )

    report = {
        "timestamp": now.isoformat(),
        "run_id": run_id,
        "attempt": attempt,
        "results": results,
    }

    report_path = day / filename

    report_path.write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8"
    )

    print(f"Saved report: {report_path}")

    # Load historical reports and normalize old formats.
    reports = load_reports()

    dashboard = build_dashboard(
        reports,
        services
    )

    dashboard_path = (
        ROOT / "dashboard-data.json"
    )

    dashboard_path.write_text(
        json.dumps(
            dashboard,
            separators=(",", ":")
        ) + "\n",
        encoding="utf-8"
    )

    print(
        f"Dashboard updated: "
        f"{len(dashboard['checks'])} checks"
    )

    # Keep the most recent 30 days of reports.
    cleanup_old_reports(now)

    up = sum(
        result["status"] == "up"
        for result in results
    )

    down = sum(
        result["status"] == "down"
        for result in results
    )

    unknown = sum(
        result["status"] == "unknown"
        for result in results
    )

    print()
    print("===== UPTIME WATCH SUMMARY =====")
    print(f"Total services: {len(services)}")
    print(f"Operational:    {up}")
    print(f"Unreachable:    {down}")
    print(f"Inconclusive:   {unknown}")
    print("================================")
    print()

    for result in results:
        print(
            f"{result['name']:<22} "
            f"{result['status'].upper():<8} "
            f"HTTP={str(result['http_status']):<5} "
            f"{result['latency_ms']}ms"
        )


if __name__ == "__main__":
    main()
