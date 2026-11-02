
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVICES = {
    "github": "https://github.com",
    "npm": "https://registry.npmjs.org",
    "pypi": "https://pypi.org",
    "cloudflare": "https://www.cloudflare.com",
    "google": "https://www.google.com",
    "vercel": "https://vercel.com",
}

def check_service(name, url):
    started = time.perf_counter()
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "uptime-watch/1.0"},
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            return {
                "service": name,
                "url": url,
                "status": status,
                "up": 200 <= status < 400,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                "error": None,
            }
    except urllib.error.HTTPError as error:
        return {
            "service": name,
            "url": url,
            "status": error.code,
            "up": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(error),
        }
    except Exception as error:
        return {
            "service": name,
            "url": url,
            "status": None,
            "up": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(error),
        }

def main():
    now = datetime.now(timezone.utc)
    results = [
        check_service(name, url)
        for name, url in SERVICES.items()
    ]

    directory = Path("data") / now.strftime("%Y-%m-%d")
    directory.mkdir(parents=True, exist_ok=True)

    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    filename = f"{now:%H-%M-%S}-{run_id}-{attempt}.json"

    report = {
        "timestamp": now.isoformat(),
        "run_id": run_id,
        "attempt": attempt,
        "services": results,
    }

    output = directory / filename
    output.write_text(json.dumps(report, indent=2) + "\n")

    print(f"Saved {output}")
    for result in results:
        print(
            f"{result['service']}: "
            f"{'UP' if result['up'] else 'DOWN'} "
            f"({result['latency_ms']} ms)"
        )

if __name__ == "__main__":
    main()
