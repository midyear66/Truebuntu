<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/src/assets/logo-tagline-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="frontend/src/assets/logo-tagline.svg">
    <img alt="Truebuntu — Lightweight NAS OS • Enterprise Stability" src="frontend/src/assets/logo-tagline.svg" width="500">
  </picture>
</p>

> **WARNING: This project is under active development and is NOT production-ready.** Expect breaking changes, bugs, missing features, and potential data loss. Use entirely at your own risk. This software manages storage, networking, and system services — mistakes can and will result in downtime, misconfiguration, or destroyed data. Do not run this on systems you cannot afford to lose. You have been warned.

A lightweight, self-hosted NAS management web UI for Ubuntu-based ZFS storage servers. Built as a modern replacement for the aging TrueNAS Core (FreeBSD) on compact hardware like the [TrueNAS Mini](https://www.truenas.com/truenas-mini/) — run a full-featured storage OS on Ubuntu with a single Docker container instead of a dedicated appliance OS.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)
![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB.svg)
![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)

## Features

**Storage** -- ZFS pool creation (mirror, raidz, raidz2, raidz3, stripe), datasets, snapshots, snapshot policies, ZFS replication, disk replace/spare/attach/offline/online/detach

**Sharing** -- SMB shares with per-share permissions and session view, NFS exports with client access lists, dedicated SMB user management, create SMB users alongside app users

**Monitoring** -- SMART health and scheduled tests, disk temperatures, enclosure view with pool mapping, per-thread CPU usage, memory and ZFS ARC tracking

**Tasks** -- Cron jobs, rsync backups (local and SSH), resilver priority windows, init/shutdown scripts, cloud sync via rclone, background job queue with cancellation

**Networking** -- Interface configuration (DHCP/static), network bonds (LACP, active-backup, balance-xor, etc.), DNS, static routes, IPMI configuration

**Services** -- Dynamic DNS (ddclient), FTP (vsftpd), UPS monitoring (NUT), OpenVPN client/server, SNMP

**System** -- Services control, hostname/timezone/NTP, reboot/shutdown from the UI, package updates, journalctl log viewer, email alerts, config export/import, TrueNAS Core migration (users, SMB shares, snapshot policies, scrub/cloud sync tasks), browser-based web shell

**Security** -- JWT auth with HTTP-only cookies, TOTP 2FA with encrypted secrets, role-based access (admin/user), rate limiting, token revocation on logout/password change, audit logging

**UI** -- Dark mode, collapsible sidebar, drag-and-drop dashboard, configurable polling interval

## Quick Start

Run the one-liner on a fresh Ubuntu/Debian x86_64 host (8 GB+ RAM):

```bash
curl -fsSL https://raw.githubusercontent.com/midyear66/Truebuntu/main/install.sh | sudo bash
```

This installs all host dependencies (Docker, ZFS, Samba, NFS, Chrony, smartmontools, rclone, netplan), clones the repo to a `truebuntu/` directory under your current working directory, generates a `.env` with a random secret key and your UID/GID, and starts the container. The install directory is owned by the calling user (detected via `SUDO_USER`).

Once complete, open `http://<your-server-ip>` in a browser and create your admin account.

<details>
<summary>Manual install</summary>

1. Clone the repository:
   ```bash
   git clone https://github.com/midyear66/Truebuntu.git ~/truebuntu
   cd ~/truebuntu
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   # Edit .env and set a random SECRET_KEY
   ```

3. Build and run with Docker Compose:
   ```bash
   docker compose up -d --build
   ```

4. Open `http://<your-server-ip>` in a browser and create your admin account.

</details>

## Hardware Requirements

Designed to run on compact, low-power NAS hardware like the TrueNAS Mini series. Install Ubuntu on the same box that previously ran TrueNAS Core and deploy Truebuntu as a Docker container.

The install script enforces **x86_64** architecture and **8 GB minimum RAM**.

### Minimum

| Component   | Spec                              |
|-------------|-----------------------------------|
| CPU         | x86_64, 2 cores                   |
| RAM         | 8 GB                              |
| Boot disk   | 32 GB SSD                         |
| Data disks  | 1+ disks (any size)               |
| Network     | 1 Gb Ethernet                     |
| OS          | Ubuntu 20.04+ or Debian 11+       |

### Recommended (home / small office)

| Component   | Spec                              |
|-------------|-----------------------------------|
| CPU         | x86_64, 4+ cores                  |
| RAM         | 16 GB (1 GB per TB of ZFS storage)|
| Boot disk   | 64 GB SSD                         |
| Data disks  | 2+ disks in mirror or raidz       |
| Network     | 1 Gb Ethernet                     |
| UPS         | Recommended (NUT supported)       |

### Target Hardware: TrueNAS Mini

This project targets the TrueNAS Mini running Ubuntu:

| Model         | CPU                        | RAM         | Drive Bays |
|---------------|----------------------------|-------------|------------|
| Mini           | Intel Atom C2558 (4-core) | 8 GB ECC    | 5 hot-swap |

Other TrueNAS Mini variants (X+, XL+, R) and similar low-power x86_64 NAS hardware should also work -- install Ubuntu Server, import your existing ZFS pools, and run Truebuntu.

<details>
<summary>Installing Ubuntu on a TrueNAS Mini</summary>

#### What You Need

- USB flash drive (2 GB+) for the Ubuntu installer
- USB keyboard (the Mini has no PS/2 ports)
- Monitor with VGA or HDMI cable (depends on model), or IPMI access (Mini R and some X+ models)
- A separate boot device -- the Mini's internal 16 GB USB DOM (Disk on Module) works, or replace it with a small SATA SSD in one of the drive bays

#### 1. Back Up Your TrueNAS Configuration

Before wiping TrueNAS, export your config and note your ZFS pool layout:

```bash
# On TrueNAS (via Shell or SSH)
zpool status
zpool list
zfs list
```

Save the output -- you'll use it to verify pool imports after Ubuntu is running.

#### 2. Create a Bootable USB Installer

Download [Ubuntu Server 22.04 LTS](https://ubuntu.com/download/server) (or 24.04 LTS) and flash it to a USB drive:

```bash
# On any Linux/macOS machine
sudo dd if=ubuntu-22.04-live-server-amd64.iso of=/dev/sdX bs=4M status=progress
```

Or use [Rufus](https://rufus.ie/) (Windows) / [balenaEtcher](https://etcher.balena.io/) (any OS).

#### 3. Boot from USB

1. Plug the USB installer and keyboard into the Mini
2. Power on and press **Delete** or **F2** to enter BIOS/UEFI setup
3. Set the boot order to boot from USB first
4. Save and exit -- the Ubuntu installer should start

> **IPMI users (Mini R):** You can mount the ISO as virtual media through the IPMI web console and install remotely without a physical keyboard/monitor.

#### 4. Install Ubuntu Server

Follow the standard Ubuntu Server installer with these considerations:

- **Install target:** Select the internal USB DOM or a dedicated boot SSD -- **do not** install onto your ZFS data disks
- **Storage layout:** Choose "Custom storage layout" and use the entire boot device as ext4 mounted at `/`. A 16-32 GB device is sufficient
- **Do not format your data disks** -- the installer should leave unselected disks alone, but double-check before confirming
- **Network:** Configure the primary Ethernet interface with DHCP or a static IP
- **OpenSSH:** Enable the OpenSSH server when prompted -- you'll want remote access
- **Minimal install:** Skip optional snaps; the Truebuntu install script handles all dependencies

#### 5. Post-Install Setup

After rebooting into Ubuntu:

```bash
# Install ZFS support
sudo apt update
sudo apt install -y zfsutils-linux

# Import your existing ZFS pools
sudo zpool import
sudo zpool import <pool-name>

# Verify pools are healthy
sudo zpool status
```

If `zpool import` doesn't find your pools, try scanning specific disks:

```bash
sudo zpool import -d /dev/disk/by-id
```

#### 6. Install Truebuntu

Once your pools are imported and healthy, run the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/midyear66/Truebuntu/main/install.sh | sudo bash
```

#### BIOS Tips for the TrueNAS Mini

- **Boot mode:** The Mini uses legacy BIOS by default. Ubuntu Server works fine in legacy mode -- no need to switch to UEFI
- **Wake-on-LAN:** Enable in BIOS if you want remote power-on capability
- **Power recovery:** Set "Restore on AC Power Loss" to **Power On** so the Mini starts automatically after a power outage
- **Fan control:** The Mini's fans are controlled by the SuperMicro BMC; Ubuntu does not need to manage them

</details>

### Notes

- **ZFS memory rule of thumb:** allocate ~1 GB of RAM per TB of raw storage for the ARC read cache. 8 GB is adequate for up to ~4 TB; 16 GB covers most home setups.
- **ECC RAM** is recommended for data integrity but not required.
- The application itself (Docker, FastAPI, React, SQLite) uses under 500 MB. The majority of RAM goes to ZFS ARC and host services (Samba, NFS).
- ARM / aarch64 is **not supported** -- the install script checks for x86_64.

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Docker Container (privileged, host network/pid)   │
│                                                    │
│  ┌────────────┐    ┌────────────────────────────┐  │
│  │   React    │    │     FastAPI Backend        │  │
│  │  (static)  │───>│                            │  │
│  │  /static/  │    │  /api/auth     /api/pools  │  │
│  └────────────┘    │  /api/datasets /api/shares │  │
│                    │  /api/disks    /api/nfs    │  │
│                    │  /api/services /api/users  │  │
│                    │  /api/tasks    /api/config │  │
│                    │  /api/rclone   /api/system │  │
│                    │  /api/network  /api/logs   │  │
│                    │  /api/alerts   /api/repl.  │  │
│                    │  /api/ddns     /api/shell  │  │
│                    │  ...37 router modules      │  │
│                    │                            │  │
│                    │  SQLite (/data/nas.db)     │  │
│                    └────────────────────────────┘  │
│                              │                     │
│                    Host: zfs, samba, nfs, systemd  │
└────────────────────────────────────────────────────┘
```

The container runs in **privileged mode** with **host network and PID namespace** to directly manage ZFS pools, system services, disks, and file sharing on the host. Resource limits (2 GB memory, 256 PIDs) are enforced via Docker Compose.

### Host Volume Mounts

| Mount                | Purpose                        |
|----------------------|--------------------------------|
| `/etc/samba`         | SMB share configuration        |
| `/etc/exports`       | NFS export configuration       |
| `/etc/passwd` (ro)   | System user enumeration        |
| `/etc/shadow` (ro)   | Password verification          |
| `/etc/group`         | System group management        |
| `/etc/gshadow` (ro)  | Group password verification    |
| `/var/lib/samba`     | Samba state and databases      |
| `/etc/chrony`        | NTP server configuration       |
| `/etc/netplan`       | Network interface configuration|
| `/var/run/dbus` (ro) | D-Bus for systemd interaction  |
| `nas-data:/data`     | Persistent SQLite database     |

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18, Vite 6, Tailwind CSS 3.4, @dnd-kit |
| Backend  | Python 3.12, FastAPI, Uvicorn       |
| Database | SQLite (aiosqlite, WAL mode)        |
| Auth     | JWT (PyJWT), bcrypt, pyotp          |
| Runtime  | Docker, Docker Compose              |

## Configuration

The `.env` file controls runtime settings. Copy `.env.example` to `.env` before starting.

| Variable        | Default                       | Description                                      |
|-----------------|-------------------------------|--------------------------------------------------|
| `SECRET_KEY`    | *(required)*                  | Secret used to sign JWT tokens. The app **will not start** if this is missing or set to a placeholder. Generate with `openssl rand -hex 24`. |
| `DATABASE_PATH` | `/data/nas.db`                | Path to the SQLite database inside the container. |
| `LOG_LEVEL`     | `info`                        | Uvicorn log level (`debug`, `info`, `warning`, `error`). |

<details>
<summary>API Overview</summary>

All endpoints are prefixed with `/api`. Authentication is required for all routes except `/api/auth/*` and `/api/migrate/*`.

| Module           | Prefix              | Description                         |
|------------------|---------------------|-------------------------------------|
| auth             | `/auth`             | Login, setup, session, app user mgmt|
| totp             | `/auth/2fa`         | TOTP two-factor authentication      |
| dashboard        | `/dashboard`        | System overview metrics             |
| pools            | `/pools`, `/disks`  | ZFS pool and available disk mgmt    |
| datasets         | `/datasets`         | ZFS dataset CRUD                    |
| snapshots        | `/snapshots`        | Snapshot and snapshot policy mgmt   |
| snapshot_policies| `/snapshot-policies`| Automated snapshot scheduling       |
| shares           | `/shares`           | SMB share management                |
| smb_users        | `/smb-users`        | Samba user management               |
| nfs              | `/nfs`              | NFS export management               |
| disks            | `/disks`            | Disk SMART and temperature          |
| enclosure        | `/enclosure`        | Hardware enclosure view             |
| users            | `/users`            | Unix user and group management      |
| services         | `/services`         | Systemd service control             |
| system           | `/system`           | Hostname, timezone, NTP, power      |
| updates          | `/updates`          | System package updates              |
| network          | `/network`          | Interface, bond, DNS, route, IPMI   |
| replication      | `/replication`      | ZFS send/receive replication tasks  |
| logs             | `/logs`             | Journalctl log viewer               |
| alerts           | `/alerts`           | SMTP config and alert categories    |
| jobs             | `/jobs`             | Background job tracking             |
| tasks            | `/tasks`            | Generic scheduled tasks             |
| cron_jobs        | `/cron-jobs`        | Cron job scheduling                 |
| rsync_tasks      | `/rsync-tasks`      | Rsync backup tasks                  |
| smart_tests      | `/smart-tests`      | SMART test scheduling               |
| resilver         | `/resilver`         | Resilver priority configuration     |
| init_shutdown    | `/init-shutdown`    | Startup/shutdown scripts            |
| rclone           | `/rclone`           | Cloud sync remote management        |
| ddns             | `/ddns`             | Dynamic DNS configuration           |
| ftp              | `/ftp`              | FTP server configuration            |
| ups              | `/ups`              | UPS monitoring (NUT)                |
| openvpn          | `/openvpn`          | OpenVPN client/server configuration |
| snmp             | `/snmp`             | SNMP daemon configuration           |
| shell            | `/shell`            | Browser-based web terminal (PTY)    |
| config           | `/config`           | Config export/import, audit log     |
| migrate          | `/migrate`          | TrueNAS config migration            |

</details>

## Development

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` requests to the FastAPI backend on port 8000. In production the React build is served as static files by FastAPI directly.

## Troubleshooting

**Container won't start -- missing host paths**
The container mounts several host directories (`/etc/samba`, `/etc/chrony`, `/etc/netplan`, etc.). If these don't exist, Docker will fail. Run the install script or create them manually:
```bash
sudo mkdir -p /etc/samba /etc/chrony /etc/netplan
sudo touch /etc/exports
```

**Can't access the web UI -- port 80 conflict**
Truebuntu binds to port 80 on the host network. If another service (Apache, nginx) already uses port 80, stop it first:
```bash
sudo systemctl stop apache2   # or nginx
```

**ZFS commands fail -- privileged mode required**
The container must run in privileged mode with host PID namespace to execute `zpool` and `zfs` commands. Verify your `docker-compose.yml` includes `privileged: true`, `network_mode: host`, and `pid: host`.

**Database locked errors**
SQLite uses WAL mode for concurrent reads, but only one writer at a time. If you see "database is locked", ensure only one instance of the container is running:
```bash
docker compose ps
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Push to your fork and open a pull request

Please keep PRs focused on a single change and include a clear description of what was modified and why.

## License

MIT
