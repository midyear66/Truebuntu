#!/usr/bin/env bash
# Truebuntu Install Script
# Usage: curl -fsSL <url>/install.sh | sudo bash
set -euo pipefail

# =============================================================================
# Configuration — edit these to customize the install
# =============================================================================
REPO_URL="https://github.com/midyear66/trubuntu.git"
INSTALL_DIR="/opt/truebuntu"
MIN_RAM_KB=8000000  # 8 GB in kB

# =============================================================================
# Color helpers (fall back to plain text when not on a terminal)
# =============================================================================
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    GREEN=$(tput setaf 2)
    RED=$(tput setaf 1)
    YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
else
    GREEN="" RED="" YELLOW="" CYAN="" BOLD="" RESET=""
fi

info()  { echo "${GREEN}[✓]${RESET} $*"; }
warn()  { echo "${YELLOW}[!]${RESET} $*"; }
err()   { echo "${RED}[✗]${RESET} $*" >&2; }
fatal() { err "$@"; exit 1; }

# =============================================================================
# 1. Pre-flight checks
# =============================================================================
preflight() {
    echo ""
    echo "${BOLD}${CYAN}========================================${RESET}"
    echo "${BOLD}${CYAN}  Truebuntu Installer${RESET}"
    echo "${BOLD}${CYAN}========================================${RESET}"
    echo ""

    # Root check
    if [ "$EUID" -ne 0 ]; then
        fatal "This script must be run as root. Use: sudo bash install.sh"
    fi
    info "Running as root"

    # OS detection
    if [ ! -f /etc/os-release ]; then
        fatal "Cannot detect OS — /etc/os-release not found"
    fi
    # shellcheck source=/dev/null
    . /etc/os-release

    local os_ok=false
    case "${ID:-}" in
        ubuntu|debian) os_ok=true ;;
    esac
    if [ "$os_ok" = false ]; then
        # Check ID_LIKE for derivatives (e.g. Linux Mint, Pop!_OS)
        case "${ID_LIKE:-}" in
            *ubuntu*|*debian*) os_ok=true ;;
        esac
    fi
    if [ "$os_ok" = false ]; then
        fatal "Unsupported OS: ${PRETTY_NAME:-$ID}. Truebuntu requires Ubuntu or Debian."
    fi
    info "OS: ${PRETTY_NAME:-$ID}"

    # Architecture
    local arch
    arch=$(uname -m)
    if [ "$arch" != "x86_64" ]; then
        fatal "Unsupported architecture: $arch. Truebuntu requires x86_64."
    fi
    info "Architecture: $arch"

    # RAM
    local mem_kb
    mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
    local mem_gb=$(( mem_kb / 1024 / 1024 ))
    if [ "$mem_kb" -lt "$MIN_RAM_KB" ]; then
        fatal "Insufficient RAM: ${mem_gb} GB detected, minimum 8 GB required."
    fi
    info "RAM: ${mem_gb} GB"

    echo ""
    echo "${BOLD}Pre-flight checks passed.${RESET}"
    echo ""
}

# =============================================================================
# 2. Install host dependencies
# =============================================================================
install_deps() {
    info "Updating package lists..."
    apt-get update -qq

    local packages=(
        docker.io
        zfsutils-linux
        samba
        nfs-kernel-server
        chrony
        smartmontools
        rclone
        netplan.io
        curl
        git
    )

    # Prefer docker-compose-v2 plugin; fall back to docker-compose
    if apt-cache show docker-compose-v2 &>/dev/null 2>&1; then
        packages+=(docker-compose-v2)
    else
        packages+=(docker-compose)
    fi

    info "Installing packages: ${packages[*]}"
    apt-get install -y -qq "${packages[@]}"

    # Enable and start Docker
    systemctl enable --now docker.service
    info "Docker is running"
}

# =============================================================================
# 3. Clone repository
# =============================================================================
clone_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        warn "$INSTALL_DIR already exists — pulling latest changes"
        git -C "$INSTALL_DIR" pull --ff-only
    else
        info "Cloning repository to $INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    info "Repository ready at $INSTALL_DIR"
}

# =============================================================================
# 4. Generate configuration
# =============================================================================
generate_config() {
    local env_file="$INSTALL_DIR/.env"
    if [ -f "$env_file" ]; then
        warn ".env already exists — preserving existing configuration"
        return
    fi

    local secret
    secret=$(openssl rand -hex 24)

    cat > "$env_file" <<EOF
SECRET_KEY=$secret
DATABASE_PATH=/data/nas.db
LOG_LEVEL=info
EOF

    info "Generated $env_file with random secret key"
}

# =============================================================================
# 5. Ensure required host paths exist
# =============================================================================
ensure_paths() {
    # /etc/samba — created by samba install
    [ -d /etc/samba ]   || mkdir -p /etc/samba
    # /etc/exports — may not exist yet
    [ -f /etc/exports ]  || touch /etc/exports
    # /etc/chrony — created by chrony install
    [ -d /etc/chrony ]  || mkdir -p /etc/chrony
    # /etc/netplan — created by netplan install
    [ -d /etc/netplan ] || mkdir -p /etc/netplan
    # /var/run/dbus — should exist
    [ -d /var/run/dbus ] || mkdir -p /var/run/dbus

    info "Host mount paths verified"
}

# =============================================================================
# 6. Build & start
# =============================================================================
build_and_start() {
    info "Building and starting Truebuntu..."
    cd "$INSTALL_DIR"
    docker compose up -d --build

    echo ""
    info "Waiting for container to start..."
    sleep 5
    docker compose ps
    echo ""
}

# =============================================================================
# 7. Post-install output
# =============================================================================
post_install() {
    local ip
    ip=$(hostname -I | awk '{print $1}')

    echo ""
    echo "${BOLD}${GREEN}========================================${RESET}"
    echo "${BOLD}${GREEN}  Truebuntu installed successfully!${RESET}"
    echo "${BOLD}${GREEN}========================================${RESET}"
    echo ""
    echo "  ${BOLD}Access URL:${RESET}    http://${ip}"
    echo "  ${BOLD}Install dir:${RESET}   ${INSTALL_DIR}"
    echo ""
    echo "  Create your admin account on first visit."
    echo ""
    echo "  ${BOLD}Useful commands:${RESET}"
    echo "    View logs:   docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
    echo "    Stop:        docker compose -f ${INSTALL_DIR}/docker-compose.yml stop"
    echo "    Start:       docker compose -f ${INSTALL_DIR}/docker-compose.yml start"
    echo "    Rebuild:     docker compose -f ${INSTALL_DIR}/docker-compose.yml up -d --build"
    echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
    preflight
    install_deps
    clone_repo
    generate_config
    ensure_paths
    build_and_start
    post_install
}

main "$@"
