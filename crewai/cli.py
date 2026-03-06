#!/usr/bin/env python3
"""
NextHello CLI - AI Networking Swarm

Usage:
    python cli.py start       # Start all services
    python cli.py api         # Start API server only
    python cli.py whatsapp    # Start WhatsApp connector only
    python cli.py connect     # Show WhatsApp QR via API
    python cli.py whatsapp-session-test  # Verify session in PostgreSQL
    python cli.py whatsapp-outbound-test --phone 7544220907  # Send + verify outbound persistence
    python cli.py worker      # Start background worker only
    python cli.py status      # Check service status
"""

import os
import sys
import subprocess
import time
import signal
import json
from datetime import datetime, timezone
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path


# Miami Vice color palette (ANSI escape codes)
class Miami:
    PINK = "\033[38;2;255;110;199m"  # Hot pink #FF6EC7
    CYAN = "\033[38;2;0;255;255m"  # Cyan #00FFFF
    ORANGE = "\033[38;2;255;107;53m"  # Sunset orange #FF6B35
    PURPLE = "\033[38;2;155;93;229m"  # Purple #9B5DE5
    YELLOW = "\033[38;2;255;217;61m"  # Sun yellow #FFD93D
    RED = "\033[91m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


# Symbols
class Symbols:
    CHECK = f"{Miami.CYAN}✓{Miami.RESET}"
    CROSS = f"{Miami.RED}✗{Miami.RESET}"
    ARROW = f"{Miami.PINK}→{Miami.RESET}"
    DOT = f"{Miami.DIM}·{Miami.RESET}"
    INFO = f"{Miami.PURPLE}ℹ{Miami.RESET}"
    WARNING = f"{Miami.ORANGE}⚠{Miami.RESET}"


# Paths
ROOT_DIR = Path(__file__).parent
BRIDGE_DIR = ROOT_DIR / "whatsapp-bridge"

# Track child processes
processes = []


def print_banner():
    """Print NextHello Miami Vice banner"""
    p = Miami.PINK
    c = Miami.CYAN
    o = Miami.ORANGE
    y = Miami.YELLOW
    r = Miami.RESET

    print("")
    print(f"{p}  _   _           _   _   _      _ _        {c}⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿{r}")
    print(f"{p} | \\ | | _____  _| |_| | | | ___| | | ___   {c}⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠙⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿{r}")
    print(f"{p} |  \\| |/ _ \\ \\/ / __| |_| |/ _ \\ | |/ _ \\  {c}⣿⣿⣿⣿⣿⣿⡀⠀⣠⣴⣶⣿⣿⣿⣿⣶⣮⣝⠻⢿⣿⣿⣿⣿⣿{r}")
    print(f"{p} | |\\  |  __/>  <| |_|  _  |  __/ | | (_) | {c}⣿⣿⣿⣿⣿⡟⣡⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠙⢿{r}")
    print(f"{p} |_| \\_|\\___/_/\\_\\\\__|_| |_|\\___|_|_|\\___/  {c}⣿⠿⣿⣿⡿⢰⣿⡿⠋⠉⠉⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⣸{r}")
    print(f"                                            {c}⠁⠀⠀⠙⠃⢿⣿⡅⠀⠀⢀⣼⣿⣿⣿⣿⠟⠛⠻⣿⣿⣷⢀⣴⣿{r}")
    print(f"  {o}NextHello{r}                                 {c}⡀⠀⠀⠀⠀⠸⣿⣛⣳⣾⣿⢿⡍⢉⣻⡇⠰⠀⠀⣿⣿⣿⢸⣿⣿{r}")
    print(f"  {c}AI Networking Swarm{r}                       {c}⣷⡀⠀⠀⠀⠀⠈⠻⢿⣿⣿⣷⣶⣬⣽⣿⣦⣤⣤⣟⣿⢇⣾⣿⣿{r}")
    print(
        f"    {y}🌴{r} {p}Made in Miami{r}                         {c}⣿⣿⣄⠀⠀⠀⠀⠀⠀⠈⠙⠻⠿⣿⣿⣿⣿⣮⣿⠟⣡⣾⣿⣿⣿{r}"
    )
    print(f"                                            {c}⣿⣿⣿⡇⢰⣶⣤⣤⣤⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿{r}")
    print("")


def print_section(title):
    """Print a section header"""
    print("")
    print(f"{Miami.BOLD}{Miami.PINK}━━━ {title} ━━━{Miami.RESET}")
    print("")


def print_success(message):
    print(f"{Symbols.CHECK} {message}")


def print_error(message):
    print(f"{Symbols.CROSS} {Miami.RED}{message}{Miami.RESET}")


def print_warning(message):
    print(f"{Symbols.WARNING} {Miami.ORANGE}{message}{Miami.RESET}")


def print_info(message):
    print(f"{Symbols.INFO} {message}")


def print_step(step, total, message):
    print(f"{Miami.DIM}[{step}/{total}]{Miami.RESET} {message}")


def print_command(description, command):
    print(f"  {Symbols.ARROW} {description}: {Miami.PINK}{command}{Miami.RESET}")


def print_box(lines):
    """Print a boxed message"""
    max_length = max(len(line) for line in lines)
    border = "─" * (max_length + 4)

    print(f"{Miami.DIM}┌{border}┐{Miami.RESET}")
    for line in lines:
        padding = " " * (max_length - len(line))
        print(f"{Miami.DIM}│{Miami.RESET}  {line}{padding}  {Miami.DIM}│{Miami.RESET}")
    print(f"{Miami.DIM}└{border}┘{Miami.RESET}")


def print_status_line(name, status, details=""):
    """Print service status"""
    if status == "running":
        icon = f"{Miami.CYAN}●{Miami.RESET}"
        status_text = f"{Miami.CYAN}running{Miami.RESET}"
    elif status == "stopped":
        icon = f"{Miami.RED}●{Miami.RESET}"
        status_text = f"{Miami.RED}stopped{Miami.RESET}"
    else:
        icon = f"{Miami.ORANGE}●{Miami.RESET}"
        status_text = f"{Miami.ORANGE}{status}{Miami.RESET}"

    print(f"  {icon} {name}: {status_text} {Miami.DIM}{details}{Miami.RESET}")


def check_redis():
    """Check if Redis is running"""
    try:
        import redis

        r = redis.Redis()
        r.ping()
        return True
    except:
        return False


def check_api():
    """Check if API is running"""
    try:
        import urllib.request

        urllib.request.urlopen("http://localhost:8001/health", timeout=2)
        return True
    except:
        return False


def check_bridge():
    """Check if WhatsApp connector is running"""
    result = subprocess.run(["pgrep", "-f", "whatsapp"], capture_output=True)
    return result.returncode == 0


def fetch_json(url, timeout=3):
    """Fetch JSON from URL"""
    with urllib.request.urlopen(url, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def post_json(url, payload, timeout=8):
    """POST JSON payload and parse JSON response."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def show_whatsapp_qr(watch=False):
    """Show connector QR via API (reusable for dashboard/API)"""
    endpoint = "http://localhost:8001/admin/api/whatsapp/connector"

    if not check_api():
        print_error("API server is not running")
        print_command("Start services", "./nexthello start")
        return False

    print_section("WhatsApp Connect")
    print_info("Fetching QR from API endpoint...")
    print_info(f"Endpoint: {Miami.CYAN}{endpoint}{Miami.RESET}")
    print("")

    last_qr = None
    spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    spin_idx = 0

    while True:
        try:
            data = fetch_json(endpoint, timeout=3)
        except urllib.error.URLError:
            print_error("Failed to reach API")
            return False
        except Exception as e:
            print_error(f"Failed to fetch connector status: {e}")
            return False

        if data.get("connected"):
            print_success("WhatsApp is connected")
            if data.get("hasRemoteSession"):
                print_success("Session is available in PostgreSQL")
            return True

        qr_text = data.get("qrText")
        qr_available = bool(data.get("qrAvailable"))

        if qr_available and qr_text and qr_text != last_qr:
            last_qr = qr_text
            print(qr_text)
            print_info(
                f"{Miami.YELLOW}Scan this QR with WhatsApp → Settings → Linked Devices{Miami.RESET}"
            )
            print("")

        if not watch:
            if qr_available:
                return True
            print_warning("QR not available yet")
            return False

        icon = spinner[spin_idx % len(spinner)]
        spin_idx += 1
        print(
            f"{Miami.DIM}{icon} waiting for connection... "
            f"remote={data.get('hasRemoteSession')} "
            f"format={data.get('remoteFormat')}{Miami.RESET}",
            end="\r",
            flush=True,
        )
        time.sleep(2)


def run_whatsapp_persistence_test(phone=None, timeout=180):
    """Manual test: wait for a fresh inbound WhatsApp message persisted in PostgreSQL."""
    endpoint = "http://localhost:8001/admin/api/whatsapp/messages/persisted"

    if not check_api():
        print_error("API server is not running")
        print_command("Start services", "./nexthello start")
        return False

    started_at = datetime.now(timezone.utc).isoformat()
    print_section("WhatsApp Persistence Test")
    print_info("Waiting for a fresh inbound WhatsApp message...")
    print_info(f"Test started at: {Miami.CYAN}{started_at}{Miami.RESET}")
    if phone:
        print_info(f"Phone filter: {Miami.CYAN}{phone}{Miami.RESET}")
    print("")
    print_info(
        f"{Miami.YELLOW}Action required:{Miami.RESET} send a new WhatsApp message to this connected number now."
    )
    print("")

    known_ids = set()
    try:
        baseline_params = {
            "direction": "inbound",
            "limit": "50",
        }
        if phone:
            baseline_params["phone"] = phone
        baseline_url = f"{endpoint}?{urllib.parse.urlencode(baseline_params)}"
        baseline = fetch_json(baseline_url, timeout=3)
        known_ids = {item.get("id") for item in (baseline.get("items") or []) if item.get("id")}
        print_info(f"Baseline loaded: {len(known_ids)} existing inbound row(s)")
    except Exception as e:
        print_warning(f"Could not load baseline rows ({e}); continuing without baseline")

    deadline = time.time() + timeout
    spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    spin_idx = 0

    while time.time() < deadline:
        params = {
            "direction": "inbound",
            "limit": "50",
        }
        if phone:
            params["phone"] = phone
        url = f"{endpoint}?{urllib.parse.urlencode(params)}"

        try:
            data = fetch_json(url, timeout=3)
        except Exception as e:
            print_error(f"Failed to query persistence endpoint: {e}")
            return False

        items = data.get("items") or []
        fresh = [item for item in items if item.get("id") and item.get("id") not in known_ids]
        if fresh:
            latest = fresh[0]
            print(" " * 100, end="\r")
            print_success("Inbound message persisted to PostgreSQL")
            print(f"  Phone:     {latest.get('phoneNumber')}")
            print(f"  CreatedAt: {latest.get('createdAt')}")
            print(f"  Type:      {latest.get('messageType')}")
            preview = (latest.get("content") or "").strip().replace("\n", " ")
            print(f"  Content:   {preview[:120]}")
            return True

        icon = spinner[spin_idx % len(spinner)]
        spin_idx += 1
        remaining = int(deadline - time.time())
        print(
            f"{Miami.DIM}{icon} waiting for inbound persisted message... {remaining}s remaining"
            f" (seen={len(items)} fresh={len(fresh)}){Miami.RESET}",
            end="\r",
            flush=True,
        )
        time.sleep(2)

    print(" " * 100, end="\r")
    print_error("No fresh inbound persisted message found before timeout")
    print_command("Check connector", "./nexthello whatsapp")
    print_command(
        "Inspect persisted rows",
        "curl http://localhost:8001/admin/api/whatsapp/messages/persisted?limit=20",
    )
    return False


def run_whatsapp_outbound_persistence_test(phone, timeout=180, message=None):
    """Manual test: send outbound WhatsApp message and verify PostgreSQL persistence."""
    send_endpoint = "http://localhost:8001/admin/api/whatsapp/send"
    persisted_endpoint = "http://localhost:8001/admin/api/whatsapp/messages/persisted"

    if not check_api():
        print_error("API server is not running")
        print_command("Start services", "./nexthello start")
        return False

    phone = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not phone:
        print_error("A valid phone number is required")
        return False

    started_at = datetime.now(timezone.utc).isoformat()
    message = (message or f"NextHello outbound flow test {started_at}").strip()

    print_section("WhatsApp Outbound Persistence Test")
    print_info(f"Target phone: {Miami.CYAN}{phone}{Miami.RESET}")
    print_info(f"Message: {Miami.CYAN}{message}{Miami.RESET}")
    print("")

    known_ids = set()
    try:
        baseline_url = f"{persisted_endpoint}?" + urllib.parse.urlencode(
            {
                "direction": "outbound",
                "phone": phone,
                "limit": "100",
            }
        )
        baseline = fetch_json(baseline_url, timeout=3)
        known_ids = {item.get("id") for item in (baseline.get("items") or []) if item.get("id")}
        print_info(f"Baseline loaded: {len(known_ids)} existing outbound row(s)")
    except Exception as e:
        print_warning(f"Could not load baseline rows ({e}); continuing without baseline")

    try:
        send_result = post_json(
            send_endpoint,
            {
                "phone_number": phone,
                "content": message,
            },
            timeout=10,
        )
    except urllib.error.HTTPError as e:
        detail = f"HTTP {e.code}"
        try:
            raw = e.read().decode("utf-8")
            if raw:
                parsed = json.loads(raw)
                detail = parsed.get("detail") or detail
        except Exception:
            pass
        print_error(f"Failed to send outbound message: {detail}")
        return False
    except Exception as e:
        print_error(f"Failed to send outbound message: {e}")
        return False

    if not send_result.get("success"):
        print_error("Send endpoint did not report success")
        return False

    sent_via = send_result.get("via")
    if sent_via != "baileys":
        print_error(f"Message was not confirmed as Baileys transport (via={sent_via})")
        return False

    print_success("Outbound message sent via Baileys")
    print(f"  Via:       {sent_via}")
    print(f"  To:        {send_result.get('to')}")
    print(f"  MessageId: {send_result.get('messageId')}")

    deadline = time.time() + timeout
    spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    spin_idx = 0

    while time.time() < deadline:
        params = {
            "direction": "outbound",
            "phone": phone,
            "limit": "100",
        }
        url = f"{persisted_endpoint}?{urllib.parse.urlencode(params)}"

        try:
            data = fetch_json(url, timeout=3)
        except Exception as e:
            print_error(f"Failed to query persistence endpoint: {e}")
            return False

        items = data.get("items") or []
        fresh = [item for item in items if item.get("id") and item.get("id") not in known_ids]
        matched = [item for item in fresh if (item.get("content") or "").strip() == message]
        if matched:
            latest = matched[0]
            print(" " * 120, end="\r")
            print_success("Outbound message persisted to PostgreSQL")
            print(f"  Phone:     {latest.get('phoneNumber')}")
            print(f"  CreatedAt: {latest.get('createdAt')}")
            print(f"  Type:      {latest.get('messageType')}")
            print(f"  Content:   {(latest.get('content') or '')[:120]}")
            return True

        icon = spinner[spin_idx % len(spinner)]
        spin_idx += 1
        remaining = int(deadline - time.time())
        print(
            f"{Miami.DIM}{icon} waiting for outbound persisted message... {remaining}s remaining"
            f" (seen={len(items)} fresh={len(fresh)}){Miami.RESET}",
            end="\r",
            flush=True,
        )
        time.sleep(2)

    print(" " * 120, end="\r")
    print_error("No fresh outbound persisted message found before timeout")
    print_command("Check connector", "./nexthello whatsapp")
    print_command(
        "Inspect persisted rows",
        f"curl '{persisted_endpoint}?direction=outbound&phone={phone}&limit=20'",
    )
    return False


def run_whatsapp_session_test(timeout=180):
    """Manual test: verify Baileys session is persisted in PostgreSQL."""
    endpoint = "http://localhost:8001/admin/api/whatsapp/connector"
    expected_format = "baileys-multifile-v1"

    if not check_api():
        print_error("API server is not running")
        print_command("Start services", "./nexthello start")
        return False

    print_section("WhatsApp Session Test")
    print_info("Checking session persistence status...")
    print_info(f"Expected remote session format: {Miami.CYAN}{expected_format}{Miami.RESET}")
    print("")

    deadline = time.time() + timeout
    spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    spin_idx = 0

    while time.time() < deadline:
        try:
            data = fetch_json(endpoint, timeout=3)
        except Exception as e:
            print_error(f"Failed to query connector status: {e}")
            return False

        connected = bool(data.get("connected"))
        has_remote = bool(data.get("hasRemoteSession"))
        remote_format = data.get("remoteFormat")
        qr_available = bool(data.get("qrAvailable"))

        if has_remote and remote_format == expected_format:
            print(" " * 120, end="\r")
            print_success("Baileys session is persisted in PostgreSQL")
            print(f"  Session ID:      {data.get('sessionId')}")
            print(f"  Remote format:   {remote_format}")
            print(f"  Connector state: {'connected' if connected else 'not connected'}")
            return True

        remaining = int(deadline - time.time())
        if qr_available:
            print(
                f"{Miami.DIM}QR required: scan with WhatsApp app. "
                f"Waiting for Baileys session backup... {remaining}s{Miami.RESET}",
                end="\r",
                flush=True,
            )
        else:
            icon = spinner[spin_idx % len(spinner)]
            spin_idx += 1
            print(
                f"{Miami.DIM}{icon} waiting... remote={has_remote} format={remote_format} connected={connected} {remaining}s{Miami.RESET}",
                end="\r",
                flush=True,
            )
        time.sleep(2)

    print(" " * 140, end="\r")
    print_error("Session test failed")
    print_info("Expected a remote session in PostgreSQL with format 'baileys-multifile-v1'.")
    print_command("Connect and scan QR", "./nexthello whatsapp")
    print_command(
        "Inspect connector status", "curl http://localhost:8001/admin/api/whatsapp/connector"
    )
    return False


def start_api():
    """Start the Python API server"""
    print_step(1, 3, "Starting API server...")

    proc = subprocess.Popen(
        ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8001"],
        cwd=ROOT_DIR,
        env=os.environ.copy(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    processes.append(proc)

    # Wait for startup
    time.sleep(2)

    if check_api():
        print_success(f"API server running at {Miami.CYAN}http://localhost:8001{Miami.RESET}")
        return True
    else:
        print_error("API server failed to start")
        return False


def start_worker():
    """Start the background worker"""
    print_step(2, 3, "Starting background worker...")

    proc = subprocess.Popen(
        ["python", "-m", "arq", "src.queue.worker.WorkerSettings"],
        cwd=ROOT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    processes.append(proc)

    time.sleep(1)
    print_success("Background worker started")
    return True


def start_whatsapp():
    """Start the WhatsApp connector"""
    print_step(3, 3, "Starting WhatsApp connector...")

    # Check if node_modules exists
    if not (BRIDGE_DIR / "node_modules").exists():
        print_info("Installing WhatsApp connector dependencies...")
        subprocess.run(
            ["npm", "install"],
            cwd=BRIDGE_DIR,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    proc = subprocess.Popen(
        ["node", "index.js"],
        cwd=BRIDGE_DIR,
    )
    processes.append(proc)

    print_success("WhatsApp connector started")
    print("")
    print_info(f"{Miami.YELLOW}Scan the QR code above with WhatsApp{Miami.RESET}")
    return True


def start_all():
    """Start all services"""
    print_banner()
    print_section("Starting Services")

    # Check prerequisites
    print_info("Checking prerequisites...")
    print("")

    if not check_redis():
        print_error("Redis is not running")
        print_command("Start Redis", "redis-server")
        return False
    print_success("Redis is running")

    # Check for .env
    env_file = ROOT_DIR / ".env"
    if not env_file.exists():
        print_warning("No .env file found - using defaults")
        print_command("Configure", "cp .env.example .env")

    print("")

    # Start services
    if not start_api():
        return False

    start_worker()
    start_whatsapp()

    print("")
    print_section("NextHello is Running")

    print_box(
        [
            f"📱  Scan the QR code with WhatsApp",
            f"📡  API: http://localhost:8001/",
            f"",
            f"Press Ctrl+C to stop all services",
        ]
    )

    print("")
    return True


def show_status():
    """Show status of all services"""
    print_banner()
    print_section("Service Status")

    print_status_line("Redis", "running" if check_redis() else "stopped")
    print_status_line(
        "API Server",
        "running" if check_api() else "stopped",
        "http://localhost:8001" if check_api() else "",
    )
    print_status_line("WhatsApp Connector", "running" if check_bridge() else "stopped")
    print("")


def cleanup(signum=None, frame=None):
    """Clean up child processes"""
    print("")
    print_info("Shutting down...")

    for proc in processes:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except:
            proc.kill()

    print_success("Goodbye! 🌴")
    sys.exit(0)


def print_help():
    """Print help message"""
    print_banner()
    print_section("Commands")

    commands = [
        ("start", "Start all services (API + Worker + WhatsApp)"),
        ("api", "Start API server only"),
        ("whatsapp", "Start WhatsApp connector only"),
        ("connect", "Show WhatsApp QR via API"),
        ("whatsapp-test", "Verify fresh inbound message is in PostgreSQL"),
        ("whatsapp-outbound-test", "Send message and verify outbound row in PostgreSQL"),
        ("whatsapp-session-test", "Verify Baileys session is in PostgreSQL"),
        ("worker", "Start background worker only"),
        ("status", "Check service status"),
    ]

    for cmd, desc in commands:
        print(f"  {Miami.PINK}{cmd:12}{Miami.RESET} {desc}")

    print("")
    print_section("Quick Start")
    print_command("1. Start Redis", "redis-server")
    print_command("2. Start NextHello", "python cli.py start")
    print("")


def main():
    """Main entry point"""
    # Set up signal handlers
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    if len(sys.argv) < 2:
        print_help()
        sys.exit(0)

    command = sys.argv[1].lower()

    if command in ("help", "-h", "--help"):
        print_help()

    elif command == "start":
        if start_all():
            try:
                while True:
                    time.sleep(1)
                    for proc in processes:
                        if proc.poll() is not None:
                            print_error("A service stopped unexpectedly")
            except KeyboardInterrupt:
                cleanup()
        else:
            sys.exit(1)

    elif command == "api":
        print_banner()
        if start_api():
            try:
                processes[0].wait()
            except KeyboardInterrupt:
                cleanup()

    elif command == "whatsapp":
        print_banner()
        start_whatsapp()
        try:
            processes[0].wait()
        except KeyboardInterrupt:
            cleanup()

    elif command == "worker":
        print_banner()
        start_worker()
        try:
            processes[0].wait()
        except KeyboardInterrupt:
            cleanup()

    elif command == "status":
        show_status()

    elif command in ("connect", "qr"):
        print_banner()
        watch = "--watch" in sys.argv[2:]
        ok = show_whatsapp_qr(watch=watch)
        if not ok:
            sys.exit(1)

    elif command in ("whatsapp-test", "wa-test"):
        print_banner()
        timeout = 180
        phone = None
        args = sys.argv[2:]
        for idx, arg in enumerate(args):
            if arg == "--timeout" and idx + 1 < len(args):
                try:
                    timeout = int(args[idx + 1])
                except ValueError:
                    pass
            if arg == "--phone" and idx + 1 < len(args):
                phone = args[idx + 1]

        ok = run_whatsapp_persistence_test(phone=phone, timeout=timeout)
        if not ok:
            sys.exit(1)

    elif command in ("whatsapp-outbound-test", "wa-outbound-test"):
        print_banner()
        timeout = 180
        phone = None
        message = None
        args = sys.argv[2:]
        for idx, arg in enumerate(args):
            if arg == "--timeout" and idx + 1 < len(args):
                try:
                    timeout = int(args[idx + 1])
                except ValueError:
                    pass
            if arg == "--phone" and idx + 1 < len(args):
                phone = args[idx + 1]
            if arg == "--message" and idx + 1 < len(args):
                message = args[idx + 1]

        if not phone:
            print_error("Missing required --phone argument")
            sys.exit(1)

        ok = run_whatsapp_outbound_persistence_test(phone=phone, timeout=timeout, message=message)
        if not ok:
            sys.exit(1)

    elif command in ("whatsapp-session-test", "wa-session-test"):
        print_banner()
        timeout = 180
        args = sys.argv[2:]
        for idx, arg in enumerate(args):
            if arg == "--timeout" and idx + 1 < len(args):
                try:
                    timeout = int(args[idx + 1])
                except ValueError:
                    pass

        ok = run_whatsapp_session_test(timeout=timeout)
        if not ok:
            sys.exit(1)

    else:
        print_error(f"Unknown command: {command}")
        print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
