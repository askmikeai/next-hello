#!/usr/bin/env python3
"""
NextHello CLI - AI Networking Swarm

Usage:
    python cli.py start       # Start all services
    python cli.py api         # Start API server only
    python cli.py whatsapp    # Start WhatsApp bridge only
    python cli.py worker      # Start background worker only
    python cli.py status      # Check service status
"""

import os
import sys
import subprocess
import time
import signal
from pathlib import Path

# Miami Vice color palette (ANSI escape codes)
class Miami:
    PINK = "\033[38;2;255;110;199m"      # Hot pink #FF6EC7
    CYAN = "\033[38;2;0;255;255m"        # Cyan #00FFFF
    ORANGE = "\033[38;2;255;107;53m"     # Sunset orange #FF6B35
    PURPLE = "\033[38;2;155;93;229m"     # Purple #9B5DE5
    YELLOW = "\033[38;2;255;217;61m"     # Sun yellow #FFD93D
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
FRONTEND_DIR = ROOT_DIR.parent / "dist" / "src" / "admin"

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
    print(f"    {y}🌴{r} {p}Made in Miami{r}                         {c}⣿⣿⣄⠀⠀⠀⠀⠀⠀⠈⠙⠻⠿⣿⣿⣿⣿⣮⣿⠟⣡⣾⣿⣿⣿{r}")
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
    """Check if WhatsApp bridge is running"""
    result = subprocess.run(
        ["pgrep", "-f", "whatsapp-bridge"],
        capture_output=True
    )
    return result.returncode == 0


def start_api():
    """Start the Python API server"""
    print_step(1, 3, "Starting API server...")

    env = os.environ.copy()
    env["FRONTEND_DIR"] = str(FRONTEND_DIR)

    proc = subprocess.Popen(
        ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8001"],
        cwd=ROOT_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    processes.append(proc)

    # Wait for startup
    time.sleep(2)

    if check_api():
        print_success(f"API server running at {Miami.CYAN}http://localhost:8001{Miami.RESET}")
        print_success(f"Dashboard at {Miami.CYAN}http://localhost:8001/admin/{Miami.RESET}")
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
    """Start the WhatsApp bridge"""
    print_step(3, 3, "Starting WhatsApp bridge...")

    # Check if node_modules exists
    if not (BRIDGE_DIR / "node_modules").exists():
        print_info("Installing WhatsApp bridge dependencies...")
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

    print_success("WhatsApp bridge started")
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

    print_box([
        f"📱  Scan the QR code with WhatsApp",
        f"🌐  Dashboard: http://localhost:8001/admin/",
        f"📡  API: http://localhost:8001/",
        f"",
        f"Press Ctrl+C to stop all services",
    ])

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
        "http://localhost:8001" if check_api() else ""
    )
    print_status_line("WhatsApp Bridge", "running" if check_bridge() else "stopped")
    print_status_line(
        "Dashboard",
        "available" if check_api() else "unavailable",
        "http://localhost:8001/admin/" if check_api() else ""
    )

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
        ("whatsapp", "Start WhatsApp bridge only"),
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

    else:
        print_error(f"Unknown command: {command}")
        print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
