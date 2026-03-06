#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  NextHello - AI-Powered Networking Assistant
#  Made in Miami
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Miami Vice colors
PINK='\033[38;2;255;110;199m'
CYAN='\033[38;2;0;255;255m'
ORANGE='\033[38;2;255;107;53m'
YELLOW='\033[38;2;255;217;61m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

print_banner() {
    echo ""
    echo -e "${PINK}  _   _           _   _   _      _ _        ${NC}"
    echo -e "${PINK} | \\ | | _____  _| |_| | | | ___| | | ___   ${NC}"
    echo -e "${PINK} |  \\| |/ _ \\ \\/ / __| |_| |/ _ \\ | |/ _ \\  ${NC}"
    echo -e "${PINK} | |\\  |  __/>  <| |_|  _  |  __/ | | (_) | ${NC}"
    echo -e "${PINK} |_| \\_|\\___/_/\\_\\\\__|_| |_|\\___|_|_|\\___/  ${NC}"
    echo ""
    echo -e "  ${ORANGE}AI Networking Assistant${NC} ${YELLOW}Made in Miami${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BOLD}${PINK}━━━ $1 ━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${CYAN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${ORANGE}⚠${NC} $1"
}

print_info() {
    echo -e "${DIM}ℹ${NC} $1"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        echo "  Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running"
        echo "  Please start Docker Desktop or the Docker daemon"
        exit 1
    fi

    print_success "Docker is running"
}

check_env() {
    if [ ! -f .env ]; then
        print_warning "No .env file found"
        if [ -f .env.example ]; then
            echo "  Creating .env from .env.example..."
            cp .env.example .env
            print_success "Created .env file"
            print_warning "Please edit .env and add your API keys"
        else
            print_error "No .env.example found"
        fi
    else
        print_success ".env file exists"
    fi
}

case "${1:-start}" in
    start)
        print_banner
        print_section "Starting NextHello"

        check_docker
        check_env
        echo ""
        print_info "Starting services..."
        docker compose up -d api worker whatsapp

        echo ""
        print_section "NextHello is Running"

        echo -e "  ${CYAN}●${NC} API:       ${CYAN}http://localhost:8001/${NC}"
        echo ""
        echo -e "  ${DIM}View logs:    docker compose logs -f${NC}"
        echo -e "  ${DIM}Stop:         docker compose down${NC}"
        echo ""
        ;;

    connect)
        print_banner
        print_section "Connect WhatsApp"

        check_docker

        print_info "Starting WhatsApp connector..."
        print_info "Scan the QR code with WhatsApp when it appears"
        echo ""

        docker compose run --rm whatsapp-connect
        ;;

    stop)
        print_banner
        print_section "Stopping NextHello"

        docker compose down
        print_success "All services stopped"
        ;;

    logs)
        docker compose logs -f ${2:-}
        ;;

    status)
        print_banner
        print_section "Service Status"

        docker compose ps
        ;;

    build)
        print_banner
        print_section "Building Images"

        docker compose build
        print_success "Build complete"
        ;;

    install)
        print_banner
        print_section "Installing NextHello CLI"

        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        CLI_PATH="$SCRIPT_DIR/bin/nexthello"

        if [ ! -f "$CLI_PATH" ]; then
            print_error "CLI script not found at $CLI_PATH"
            exit 1
        fi

        # Determine install location
        if [ -w /usr/local/bin ]; then
            INSTALL_DIR="/usr/local/bin"
        else
            INSTALL_DIR="$HOME/bin"
            mkdir -p "$INSTALL_DIR"
        fi

        TARGET="$INSTALL_DIR/nexthello"

        # Remove existing symlink if present
        if [ -L "$TARGET" ]; then
            rm "$TARGET"
        fi

        # Create symlink
        ln -s "$CLI_PATH" "$TARGET"

        if [ $? -eq 0 ]; then
            print_success "Installed nexthello to $TARGET"
            echo ""
            echo -e "  ${CYAN}Usage:${NC} nexthello <command>"
            echo ""

            # Check if install dir is in PATH
            if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
                print_warning "$INSTALL_DIR is not in your PATH"
                echo -e "  Add this to your ~/.zshrc or ~/.bashrc:"
                echo -e "  ${DIM}export PATH=\"\$PATH:$INSTALL_DIR\"${NC}"
                echo ""
            fi
        else
            print_error "Failed to create symlink"
            echo "  Try running with sudo: sudo ./start.sh install"
        fi
        ;;

    uninstall)
        print_banner
        print_section "Uninstalling NextHello CLI"

        for INSTALL_DIR in /usr/local/bin "$HOME/bin"; do
            TARGET="$INSTALL_DIR/nexthello"
            if [ -L "$TARGET" ]; then
                rm "$TARGET"
                print_success "Removed $TARGET"
            fi
        done
        ;;

    *)
        print_banner
        print_section "Commands"

        echo -e "  ${PINK}start${NC}      Start all services"
        echo -e "  ${PINK}connect${NC}    Connect WhatsApp (scan QR code)"
        echo -e "  ${PINK}stop${NC}       Stop all services"
        echo -e "  ${PINK}logs${NC}       View logs (optionally: logs api)"
        echo -e "  ${PINK}status${NC}     Show service status"
        echo -e "  ${PINK}build${NC}      Rebuild Docker images"
        echo -e "  ${PINK}install${NC}    Install 'nexthello' command globally"
        echo -e "  ${PINK}uninstall${NC}  Remove 'nexthello' command"
        echo ""
        echo -e "  ${DIM}Usage: ./start.sh [command]${NC}"
        echo ""
        ;;
esac
