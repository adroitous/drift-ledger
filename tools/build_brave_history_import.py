import argparse
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


CHROME_EPOCH_SECONDS = 11644473600
INFERENCE_CAP_SECONDS = 600
SESSION_GAP_SECONDS = 1800
DRIFT_CATEGORIES = {"social", "video", "sports", "game_stats"}

CATEGORY_RULES = {
    "social": {
        "reddit.com",
        "x.com",
        "twitter.com",
        "instagram.com",
        "facebook.com",
        "tiktok.com",
    },
    "video": {"youtube.com", "twitch.tv", "bilibili.com", "netflix.com", "olevod.com"},
    "sports": {"espn.com", "mlb.com", "hupu.com"},
    "game_stats": {
        "op.gg",
        "u.gg",
        "metatft.com",
        "datatft.com",
        "tftacademy.com",
        "vlr.gg",
        "chess.com",
    },
    "coding": {"neetcode.io", "leetcode.com", "github.com"},
    "search": {"google.com", "bing.com", "duckduckgo.com"},
}

TWO_PART_SUFFIXES = {
    "co.uk",
    "org.uk",
    "com.au",
    "net.au",
    "co.jp",
    "co.nz",
    "com.br",
    "com.mx",
    "co.in",
}


def chrome_timestamp(local_datetime):
    return int((local_datetime.timestamp() + CHROME_EPOCH_SECONDS) * 1_000_000)


def local_datetime(chrome_microseconds):
    unix_seconds = chrome_microseconds / 1_000_000 - CHROME_EPOCH_SECONDS
    return datetime.fromtimestamp(unix_seconds)


def normalize_domain(url):
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname.startswith("www.") or hostname.startswith("m."):
        hostname = hostname.split(".", 1)[1]
    if hostname == "localhost" or ":" in hostname:
        return hostname
    parts = hostname.split(".")
    if all(part.isdigit() for part in parts):
        return hostname
    if len(parts) <= 2:
        return hostname
    last_two = ".".join(parts[-2:])
    if last_two in TWO_PART_SUFFIXES:
        return ".".join(parts[-3:])
    return last_two


def classify(domain):
    for category, domains in CATEGORY_RULES.items():
        if any(domain == candidate or domain.endswith(f".{candidate}") for candidate in domains):
            return category
    return "other"


def recurring_top_three(sequence):
    if len(sequence) < 12:
        return False
    counts = Counter(sequence)
    top_share = sum(count for _, count in counts.most_common(3)) / len(sequence)
    switches = sum(sequence[index] != sequence[index - 1] for index in range(1, len(sequence)))
    return len(counts) >= 2 and top_share >= 0.8 and switches >= 6


def score_block(block):
    active_seconds = block["estimatedActiveSeconds"]
    drift_seconds = sum(
        seconds
        for category, seconds in block["categories"].items()
        if category in DRIFT_CATEGORIES
    )
    drift_share = drift_seconds / active_seconds if active_seconds else 0
    navigation_rate = block["visits"] / (active_seconds / 3600) if active_seconds else 0

    if (
        active_seconds >= 90 * 60
        and drift_share >= 0.75
        and (navigation_rate >= 40 or recurring_top_three(block["sequence"]))
    ):
        risk = "high"
    elif active_seconds >= 45 * 60 and drift_share >= 0.6 and block["visits"] >= 30:
        risk = "medium"
    else:
        risk = "low"
    return risk, drift_seconds, drift_share, navigation_rate


def empty_day():
    return {
        "estimatedActiveSeconds": 0.0,
        "visits": 0,
        "domains": {},
        "categories": defaultdict(float),
        "drift": {
            "estimatedSeconds": 0.0,
            "share": 0.0,
            "mediumBlocks": 0,
            "highBlocks": 0,
        },
    }


def empty_block(timestamp):
    return {
        "start": timestamp,
        "end": timestamp,
        "estimatedActiveSeconds": 0.0,
        "visits": 0,
        "domains": defaultdict(float),
        "categories": defaultdict(float),
        "sequence": [],
        "perDayDomains": defaultdict(lambda: defaultdict(float)),
    }


def ensure_day_domain(day, domain, category):
    if domain not in day["domains"]:
        day["domains"][domain] = {
            "category": category,
            "estimatedActiveSeconds": 0.0,
            "visits": 0,
            "sessions": 0,
            "maxSessionSeconds": 0.0,
        }
    return day["domains"][domain]


def finalize_block(block, daily, historical_blocks):
    if not block:
        return
    risk, drift_seconds, drift_share, navigation_rate = score_block(block)
    for day_key, domains in block["perDayDomains"].items():
        for domain, seconds in domains.items():
            domain_record = daily[day_key]["domains"][domain]
            domain_record["sessions"] += 1
            domain_record["maxSessionSeconds"] = max(
                domain_record["maxSessionSeconds"],
                seconds,
            )
    if risk in {"medium", "high"}:
        start_day = block["start"].strftime("%Y-%m-%d")
        daily[start_day]["drift"][f"{risk}Blocks"] += 1
        historical_blocks.append(
            {
                "start": block["start"].isoformat(timespec="seconds"),
                "end": block["end"].isoformat(timespec="seconds"),
                "estimatedActiveSeconds": round(block["estimatedActiveSeconds"]),
                "visits": block["visits"],
                "risk": risk,
                "driftSeconds": round(drift_seconds),
                "driftShare": round(drift_share, 4),
                "navigationRate": round(navigation_rate, 1),
                "topDomains": [domain for domain, _ in Counter(block["sequence"]).most_common(5)],
                "categories": {
                    category: round(seconds)
                    for category, seconds in sorted(block["categories"].items())
                    if seconds > 0
                },
            }
        )


def build_import(history_path, start, end, profile):
    connection = sqlite3.connect(f"file:{history_path}?mode=ro", uri=True)
    rows = connection.execute(
        """
        SELECT v.visit_time, v.visit_duration, u.url
        FROM visits v
        JOIN urls u ON u.id = v.url
        WHERE v.visit_time >= ? AND v.visit_time <= ?
        ORDER BY v.visit_time
        """,
        (chrome_timestamp(start), chrome_timestamp(end)),
    ).fetchall()
    connection.close()

    visits = []
    for visit_time, visit_duration, url in rows:
        domain = normalize_domain(url)
        if domain:
            visits.append((visit_time, visit_duration or 0, domain))

    daily = defaultdict(empty_day)
    historical_blocks = []
    current_block = None
    previous_time = None
    session_count = 0
    recorded_seconds = 0.0
    inferred_seconds = 0.0

    for index, (visit_time, visit_duration, domain) in enumerate(visits):
        timestamp = local_datetime(visit_time)
        next_visit_time = visits[index + 1][0] if index + 1 < len(visits) else chrome_timestamp(end)
        gap_seconds = max(0.0, (next_visit_time - visit_time) / 1_000_000)
        duration_seconds = visit_duration / 1_000_000 if visit_duration > 0 else gap_seconds
        credited_seconds = min(duration_seconds, gap_seconds, INFERENCE_CAP_SECONDS)
        category = classify(domain)
        day_key = timestamp.strftime("%Y-%m-%d")

        if previous_time is None or (visit_time - previous_time) / 1_000_000 > SESSION_GAP_SECONDS:
            finalize_block(current_block, daily, historical_blocks)
            current_block = empty_block(timestamp)
            session_count += 1
        previous_time = visit_time

        day = daily[day_key]
        day["estimatedActiveSeconds"] += credited_seconds
        day["visits"] += 1
        day["categories"][category] += credited_seconds
        domain_record = ensure_day_domain(day, domain, category)
        domain_record["estimatedActiveSeconds"] += credited_seconds
        domain_record["visits"] += 1

        current_block["end"] = timestamp
        current_block["estimatedActiveSeconds"] += credited_seconds
        current_block["visits"] += 1
        current_block["domains"][domain] += credited_seconds
        current_block["categories"][category] += credited_seconds
        current_block["sequence"].append(domain)
        current_block["perDayDomains"][day_key][domain] += credited_seconds

        if visit_duration > 0:
            recorded_seconds += credited_seconds
        else:
            inferred_seconds += credited_seconds

    finalize_block(current_block, daily, historical_blocks)

    sites = defaultdict(
        lambda: {
            "category": "other",
            "estimatedActiveSeconds": 0.0,
            "visits": 0,
            "sessions": 0,
            "activeDays": 0,
            "maxSessionSeconds": 0.0,
        }
    )
    total_seconds = 0.0
    for day in daily.values():
        drift_seconds = sum(
            seconds
            for category, seconds in day["categories"].items()
            if category in DRIFT_CATEGORIES
        )
        day["drift"]["estimatedSeconds"] = drift_seconds
        day["drift"]["share"] = (
            drift_seconds / day["estimatedActiveSeconds"]
            if day["estimatedActiveSeconds"]
            else 0
        )
        total_seconds += day["estimatedActiveSeconds"]
        for domain, record in day["domains"].items():
            site = sites[domain]
            site["category"] = record["category"]
            site["estimatedActiveSeconds"] += record["estimatedActiveSeconds"]
            site["visits"] += record["visits"]
            site["sessions"] += record["sessions"]
            site["activeDays"] += 1
            site["maxSessionSeconds"] = max(site["maxSessionSeconds"], record["maxSessionSeconds"])

    normalized_daily = {}
    for day_key, day in sorted(daily.items()):
        normalized_daily[day_key] = {
            "estimatedActiveSeconds": round(day["estimatedActiveSeconds"]),
            "visits": day["visits"],
            "domains": {
                domain: {
                    **record,
                    "estimatedActiveSeconds": round(record["estimatedActiveSeconds"]),
                    "maxSessionSeconds": round(record["maxSessionSeconds"]),
                }
                for domain, record in sorted(day["domains"].items())
            },
            "categories": {
                category: round(seconds)
                for category, seconds in sorted(day["categories"].items())
                if seconds > 0
            },
            "drift": {
                **day["drift"],
                "estimatedSeconds": round(day["drift"]["estimatedSeconds"]),
                "share": round(day["drift"]["share"], 4),
            },
        }

    normalized_sites = {}
    for domain, site in sorted(sites.items()):
        normalized_sites[domain] = {
            **site,
            "estimatedActiveSeconds": round(site["estimatedActiveSeconds"]),
            "maxSessionSeconds": round(site["maxSessionSeconds"]),
            "averageSecondsPerVisit": round(
                site["estimatedActiveSeconds"] / site["visits"] if site["visits"] else 0,
                1,
            ),
            "averageSecondsPerSession": round(
                site["estimatedActiveSeconds"] / site["sessions"] if site["sessions"] else 0,
                1,
            ),
        }

    high_blocks = sum(block["risk"] == "high" for block in historical_blocks)
    medium_blocks = sum(block["risk"] == "medium" for block in historical_blocks)
    identity = hashlib.sha256(
        f"Brave|{profile}|{start.isoformat()}|{end.isoformat()}|{len(visits)}|{round(total_seconds)}".encode()
    ).hexdigest()[:16]

    return {
        "schema": "drift-ledger-brave-history-v1",
        "id": f"brave-{identity}",
        "browser": "Brave",
        "profile": profile,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "coverage": {
            "start": start.astimezone().isoformat(timespec="seconds"),
            "end": end.astimezone().isoformat(timespec="seconds"),
        },
        "methodology": {
            "measurement": "estimated",
            "source": "Brave History database snapshot",
            "inferenceCapSeconds": INFERENCE_CAP_SECONDS,
            "sessionGapSeconds": SESSION_GAP_SECONDS,
            "recordedContributionSeconds": round(recorded_seconds),
            "inferredContributionSeconds": round(inferred_seconds),
            "fullUrlsStored": False,
            "searchQueriesStored": False,
            "pageContentStored": False,
        },
        "totals": {
            "estimatedActiveSeconds": round(total_seconds),
            "visits": len(visits),
            "activeDays": sum(day["estimatedActiveSeconds"] > 0 for day in daily.values()),
            "sessions": session_count,
            "mediumDriftBlocks": medium_blocks,
            "highDriftBlocks": high_blocks,
        },
        "daily": normalized_daily,
        "sites": normalized_sites,
        "driftBlocks": historical_blocks,
    }


def main():
    parser = argparse.ArgumentParser(description="Build a Brave-only historical import for Drift Ledger.")
    parser.add_argument("--history", required=True, type=Path)
    parser.add_argument("--start", required=True, help="Local ISO timestamp")
    parser.add_argument("--end", required=True, help="Local ISO timestamp")
    parser.add_argument("--profile", default="Default")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    payload = build_import(
        args.history.resolve(),
        datetime.fromisoformat(args.start).astimezone(),
        datetime.fromisoformat(args.end).astimezone(),
        args.profile,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "estimatedHours": round(payload["totals"]["estimatedActiveSeconds"] / 3600, 2),
                "visits": payload["totals"]["visits"],
                "sites": len(payload["sites"]),
                "driftBlocks": len(payload["driftBlocks"]),
            }
        )
    )


if __name__ == "__main__":
    main()
