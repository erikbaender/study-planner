#!/usr/bin/env python3
"""Read plan limits from the providers' interactive /usage screens.

This uses only local CLI slash commands; it does not send a model prompt.
"""

import argparse
import datetime
import json
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time


# Covers CSI, OSC, and single-character terminal control sequences (for example
# save/restore cursor). The latter are emitted frequently by the Codex TUI.
ANSI = re.compile(
    r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-Z\\-_])"
)


def clean_terminal_output(value):
    value = ANSI.sub("", value).replace("\r", "\n")
    return "".join(char for char in value if char in "\n\t" or ord(char) >= 32)


def summarize_error(command, output):
    """Return a short, plain-text diagnostic instead of raw TUI repaint data."""
    compact = re.sub(r"\s+", " ", output).strip()
    if "readonly database" in compact.lower() or "read-only database" in compact.lower():
        return f"{command} could not initialize its local state database"
    if "local database appears to be damaged" in compact.lower():
        return f"{command} reported a damaged local state database"
    return f"{command} did not return usage data"


def run_usage_screen(command, timeout=15):
    """Launch a CLI in a PTY, run /usage, and return its rendered screen."""
    if not shutil.which(command):
        return None, f"{command} CLI is not installed"

    pid, fd = pty.fork()
    if pid == 0:
        child_env = os.environ.copy()
        child_env.update({"TERM": "xterm-256color", "COLUMNS": "120", "LINES": "40"})
        os.execvpe(command, [command], child_env)

    output = bytearray()
    deadline = time.monotonic() + timeout
    sent_usage = False
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], 0.25)
            if readable:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError:
                    break

            if not sent_usage and time.monotonic() + 0.1 >= deadline - timeout + 1:
                os.write(fd, b"/usage\r")
                sent_usage = True

            cleaned = clean_terminal_output(output.decode("utf-8", errors="replace"))
            if sent_usage and re.search(r"Current\s*week", cleaned, re.IGNORECASE) and "used" in cleaned:
                break
    finally:
        try:
            os.write(fd, b"\x03")
        except OSError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass

    cleaned = clean_terminal_output(output.decode("utf-8", errors="replace"))
    if not re.search(r"Current\s*week", cleaned, re.IGNORECASE):
        return None, summarize_error(command, cleaned)
    return cleaned, None


def parse_limit(screen, heading):
    heading_pattern = {
        "Current session": r"Current\s*sessi\w*",
        "Current week": r"Current\s*week",
    }[heading]
    heading_match = re.search(heading_pattern, screen, re.IGNORECASE)
    if not heading_match:
        return {
            "remainingPercent": None,
            "reset": None,
            "status": "unavailable",
        }

    section = screen[heading_match.start() : heading_match.start() + 500]
    used_match = re.search(r"(\d+(?:\.\d+)?)%\s*used", section)
    reset_match = re.search(r"Resets\s*([^\n]+)", section, re.IGNORECASE)
    used = float(used_match.group(1)) if used_match else None
    if used is not None and used.is_integer():
        used = int(used)
    return {
        "remainingPercent": 100 - used if used is not None else None,
        "reset": reset_match.group(1).strip() if reset_match else None,
        "status": "available" if used is not None else "unavailable",
    }


def empty_limit(status="unavailable"):
    return {
        "remainingPercent": None,
        "reset": None,
        "status": status,
    }


def format_reset(timestamp):
    if timestamp is None:
        return None
    return datetime.datetime.fromtimestamp(
        timestamp, datetime.timezone.utc
    ).astimezone().isoformat(timespec="minutes")


def rate_limit_from_window(window, status="unavailable"):
    if not window or window.get("usedPercent") is None:
        return empty_limit(status)
    used = window["usedPercent"]
    return {
        "remainingPercent": max(0, 100 - used),
        "reset": format_reset(window.get("resetsAt")),
        "status": "available",
    }


def read_codex_rate_limits(timeout=15):
    """Read Codex limits through its structured app-server protocol."""
    if not shutil.which("codex"):
        return None, "codex CLI is not installed"

    sqlite_workspace = tempfile.TemporaryDirectory(
        prefix="check-agent-usage-codex-", dir="/tmp"
    )
    child_env = os.environ.copy()
    child_env["CODEX_SQLITE_HOME"] = sqlite_workspace.name
    process = subprocess.Popen(
        [
            "codex",
            "app-server",
            "--stdio",
            "-c",
            f'log_dir="{sqlite_workspace.name}/log"',
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=child_env,
    )
    requests = [
        {
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {"name": "check-agent-usage", "version": "1.0.0"},
                "capabilities": None,
            },
        },
        {"method": "initialized"},
        {"id": 2, "method": "account/rateLimits/read", "params": None},
    ]

    try:
        for request in requests:
            process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            readable, _, _ = select.select([process.stdout], [], [], 0.25)
            if not readable:
                if process.poll() is not None:
                    break
                continue
            line = process.stdout.readline()
            if not line:
                break
            try:
                response = json.loads(line)
            except json.JSONDecodeError:
                continue
            if response.get("id") == 2:
                if response.get("error"):
                    return None, "codex app-server could not read account rate limits"
                return response.get("result"), None
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        sqlite_workspace.cleanup()

    stderr = process.stderr.read() if process.stderr else ""
    return None, summarize_error("codex", clean_terminal_output(stderr))


def check_openai():
    result, error = read_codex_rate_limits()
    if error:
        return {
            "provider": "openai",
            "status": "error",
            "session": empty_limit("temporarily_removed"),
            "weekly": empty_limit(),
        }

    snapshot = result.get("rateLimits") or {}
    by_limit_id = result.get("rateLimitsByLimitId") or {}
    snapshot = by_limit_id.get("codex", snapshot)
    windows = [
        window
        for window in (snapshot.get("primary"), snapshot.get("secondary"))
        if window
    ]
    weekly_window = next(
        (
            window
            for window in windows
            if (window.get("windowDurationMins") or 0) >= 6 * 24 * 60
        ),
        snapshot.get("secondary"),
    )

    return {
        "provider": "openai",
        "status": "available",
        "session": empty_limit("temporarily_removed"),
        "weekly": rate_limit_from_window(weekly_window),
    }


def check_provider(provider, command):
    screen, error = run_usage_screen(command)
    if error:
        session_status = "temporarily_removed" if provider == "openai" else "unavailable"
        return {
            "provider": provider,
            "status": "error",
            "session": {
                "remainingPercent": None,
                "reset": None,
                "status": session_status,
            },
            "weekly": {
                "remainingPercent": None,
                "reset": None,
                "status": "unavailable",
            },
        }

    session = parse_limit(screen, "Current session")
    weekly = parse_limit(screen, "Current week")
    if provider == "openai":
        session.update({
            "usedPercent": None,
            "remainingPercent": None,
            "reset": None,
            "status": "temporarily_removed",
        })

    return {
        "provider": provider,
        "status": "available",
        "session": session,
        "weekly": weekly,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--provider", choices=("anthropic", "openai"), action="append")
    # pnpm preserves the separator when invoking a package script.
    cli_args = [arg for arg in sys.argv[1:] if arg != "--"]
    args = parser.parse_args(cli_args)

    providers = args.provider or ["anthropic", "openai"]
    checks = []
    for provider in providers:
        checks.append(
            check_provider(provider, "claude")
            if provider == "anthropic"
            else check_openai()
        )

    result = {
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "checks": checks,
    }
    result["conservativeAction"] = (
        "conserve"
        if any(
            check["weekly"]["remainingPercent"] is None
            or (
                check["session"]["remainingPercent"] is None
                and check["session"]["status"] != "temporarily_removed"
            )
            for check in checks
        )
        else "normal"
    )

    if args.json:
        print(json.dumps(result, indent=2))
        return

    print("Agent usage preflight")
    for check in checks:
        print(f"\n{check['provider']}: {check['status']}")
        for period in ("session", "weekly"):
            limit = check[period]
            print(
                f"  {period}: remaining={limit['remainingPercent']}%, reset={limit['reset']} "
                f"({limit['status']})"
            )
    print(f"\nRecommendation: {result['conservativeAction']}.")


if __name__ == "__main__":
    main()
