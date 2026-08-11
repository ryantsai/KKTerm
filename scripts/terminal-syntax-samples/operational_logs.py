#!/usr/bin/env python3
"""Interactive random log stream for KKTerm Operational Logs highlighting tests."""

import argparse
import datetime
import random
import time


LEVELS = ["TRACE", "DEBUG", "INFO", "OK", "WARN", "ERROR", "CRITICAL"]
TEMPLATES = {
    "TRACE": [
        "TRACE request_id={request_id} route lookup completed for {ip}",
        "VERBOSE cache probe key=node:{node} result=miss",
    ],
    "DEBUG": [
        "DEBUG worker={node} accepted job request_id={request_id}",
        "DEBUG upstream={ip}:443 connection pool size={count}",
    ],
    "INFO": [
        "INFO service STARTED on {ip}:8080 and is READY",
        "INFO health probe returned {good_http}; node {node} HEALTHY",
        "INFO deployment completed with SUCCESS; {count} checks PASSED",
    ],
    "OK": [
        "OK backup complete: {count} objects copied to node {node}",
        "PASS connectivity test to {ip}; status={good_http}",
    ],
    "WARN": [
        "WARN request RETRY after TIMEOUT from upstream {ip}",
        "WARNING API v1 is DEPRECATED; response={bad_http}",
    ],
    "ERROR": [
        "ERROR request FAILED with HTTP {bad_http} from {ip}",
        "ERR database TIMEOUT on node {node}; retry exhausted",
        "EXCEPTION handler rejected request_id={request_id} status={bad_http}",
    ],
    "CRITICAL": [
        "CRITICAL disk allocator PANIC on node {node}",
        "FATAL quorum FAILED; peer {ip} unreachable",
    ],
}


def random_ip():
    octets = list(random.choice([(10,), (172, 16), (192, 0, 2), (198, 51, 100), (203, 0, 113)]))
    while len(octets) < 4:
        octets.append(random.randint(1, 254))
    return ".".join(str(octet) for octet in octets)


def timestamp():
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def render_log(level=None):
    selected = level or random.choices(LEVELS, weights=[4, 10, 26, 12, 18, 20, 10], k=1)[0]
    template = random.choice(TEMPLATES[selected])
    message = template.format(
        ip=random_ip(),
        node=f"api-{random.randint(1, 8):02d}",
        count=random.randint(1, 9999),
        request_id="".join(random.choices("0123456789abcdef", k=12)),
        good_http=random.choice([200, 201, 204, 304]),
        bad_http=random.choice([400, 401, 403, 404, 409, 429, 500, 502, 503, 504]),
    )
    return f"{timestamp()} {message}"


def emit(count, level=None, delay=0.0):
    for _ in range(max(1, min(count, 500))):
        print(render_log(level), flush=True)
        if delay:
            time.sleep(delay)


def demo():
    print("2026-08-11T14:22:01.123Z TRACE DEBUG VERBOSE 10.10.10.1")
    print("2026-08-11T14:22:02.234+08:00 OK PASS PASSED SUCCESS HEALTHY READY STARTED 192.0.2.10")
    print("2026-08-11 14:22:03 WARN WARNING DEPRECATED RETRY TIMEOUT HTTP 429 from 198.51.100.8")
    print("2026-08-11T14:22:04Z ERROR ERR CRITICAL PANIC EXCEPTION FAILED FATAL HTTP 503 from 203.0.113.9")


def print_help():
    print("Supported commands:")
    print("  emit [COUNT]                emit random log records (default: 12)")
    print("  follow [COUNT]              emit records gradually (default: 30)")
    print("  level [LEVEL|any]           filter future records to one severity")
    print("  demo                        print every built-in highlight category")
    print("  clear                       clear the terminal")
    print("  help | ?                    show this command list")
    print("  exit | quit                 leave the emulator")
    print("Levels: TRACE, DEBUG, INFO, OK, WARN, ERROR, CRITICAL, any")


def trailing_count(command, default):
    parts = command.split()
    if len(parts) == 1:
        return default
    try:
        return int(parts[1])
    except ValueError:
        print("ERROR invalid count; expected an integer from 1 to 500")
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, help="make randomized output repeatable")
    args = parser.parse_args()
    random.seed(args.seed)

    selected_level = None
    print("Operational Logs mock stream for KKTerm keyword highlighting")
    print("Type help or ? for supported commands. Type demo for full keyword coverage.\n")
    emit(8)

    while True:
        try:
            raw = input("logs> ")
        except (EOFError, KeyboardInterrupt):
            print("\nLog stream stopped.")
            break

        command = " ".join(raw.strip().split())
        lowered = command.lower()
        if not command:
            continue
        if lowered in {"help", "?"}:
            print_help()
        elif lowered in {"quit", "exit"}:
            print("Log stream stopped.")
            break
        elif lowered == "demo":
            demo()
        elif lowered == "clear":
            print("\033[2J\033[H", end="", flush=True)
        elif lowered.startswith("emit"):
            count = trailing_count(lowered, 12)
            if count is not None:
                emit(count, selected_level)
        elif lowered.startswith("follow"):
            count = trailing_count(lowered, 30)
            if count is not None:
                try:
                    emit(count, selected_level, delay=0.15)
                except KeyboardInterrupt:
                    print("\nWARN follow interrupted; prompt READY")
        elif lowered.startswith("level "):
            requested = lowered.split(" ", 1)[1].upper()
            if requested == "ANY":
                selected_level = None
                print("OK level filter disabled; random severities enabled")
            elif requested in LEVELS:
                selected_level = requested
                print(f"OK level filter set to {requested}")
            else:
                print(f"ERROR invalid level {requested}; use TRACE, DEBUG, INFO, OK, WARN, ERROR, CRITICAL, or any")
        else:
            print(f"{timestamp()} ERROR unknown command; HTTP 400 from 127.0.0.1")


if __name__ == "__main__":
    main()
