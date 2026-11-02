
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
            "Accept": "text/html,application/json,*/*"
        },
    )

    status = None
    error = None

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        error = str(exc)
    except Exception as exc:
        error = str(exc)[:300]

    latency = round((time.perf_counter() - started) * 1000, 2)

    # Authentication and rate limiting are not automatically outages.
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
    cutoff = utc_now() - timedelta(days=RETENTION_DAYS)
    reports = []

    for path in sorted(DATA.glob("*/*.json")):
        try:
            report = json.loads(path.read_text())
            timestamp = datetime.fromisoformat(report["timestamp"])
            if timestamp >= cutoff:
                reports.append(report)
        except (ValueError, KeyError, OSError):
            continue

    reports.sort(key=lambda item: item["timestamp"])
    return reports


def build_dashboard(reports, services):
    return {
        "generated_at": utc_now().isoformat(),
        "interval_minutes": 15,
        "services": services,
        "checks": [
            {
                "timestamp": report["timestamp"],
                "results": report["results"]
            }
            for report in reports
        ],
    }


def main():
    config = json.loads((ROOT / "services.json").read_text())
    services = config["services"]

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=WORKERS
    ) as executor:
        results = list(executor.map(check, services))

    now = utc_now()
    day = DATA / now.strftime("%Y-%m-%d")
    day.mkdir(parents=True, exist_ok=True)

    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    filename = f"{now:%H-%M-%S}-{run_id}-{attempt}.json"

    report = {
        "timestamp": now.isoformat(),
        "run_id": run_id,
        "results": results,
    }

    path = day / filename
    path.write_text(json.dumps(report, indent=2) + "\n")

    reports = load_reports()
    dashboard = build_dashboard(reports, services)

    (ROOT / "dashboard-data.json").write_text(
        json.dumps(dashboard, separators=(",", ":")) + "\n"
    )

    # Remove raw reports older than retention window.
    cutoff_date = (now - timedelta(days=RETENTION_DAYS)).date()
    for folder in DATA.iterdir():
        if not folder.is_dir():
            continue
        try:
            folder_date = datetime.strptime(
                folder.name, "%Y-%m-%d"
            ).date()
        except ValueError:
            continue
        if folder_date < cutoff_date:
            for old_file in folder.glob("*.json"):
                old_file.unlink()
            try:
                folder.rmdir()
            except OSError:
                pass

    up = sum(r["status"] == "up" for r in results)
    down = sum(r["status"] == "down" for r in results)
    unknown = sum(r["status"] == "unknown" for r in results)

    print(f"Report: {path}")
    print(f"UP: {up} | DOWN: {down} | UNKNOWN: {unknown}")

    for result in results:
        print(
            f"{result['name']}: {result['status']} "
            f"HTTP={result['http_status']} "
            f"{result['latency_ms']}ms"
        )


if __name__ == "__main__":
    main()
