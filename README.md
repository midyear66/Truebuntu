# Truebuntu

A lightweight, self-hosted NAS management web UI for Ubuntu-based ZFS storage servers. Built as a modern replacement for the aging TrueNAS Core (FreeBSD) on compact hardware like the [TrueNAS Mini](https://www.truenas.com/truenas-mini/) — run a full-featured storage OS on Ubuntu with a single Docker container instead of a dedicated appliance OS.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)
![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB.svg)
![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)

## Features

**Storage** -- ZFS pool creation (mirror, raidz, raidz2, raidz3, stripe), datasets, snapshots, snapshot policies, ZFS replication, disk replace/spare/attach/offline/online/detach

**Sharing** -- SMB shares with per-share permissions and session view, NFS exports with client access lists, dedicated SMB user management

**Monitoring** -- SMART health and scheduled tests, disk temperatures, enclosure view with pool mapping, per-thread CPU usage, memory and ZFS ARC tracking

**Tasks** -- Cron jobs, rsync backups (local and SSH), resilver priority windows, init/shutdown scripts, cloud sync via rclone, background job queue with cancellation

**Networking** -- Interface configuration (DHCP/static), network bonds (LACP, active-backup, balance-xor, etc.), DNS, static routes, IPMI configuration

**Services** -- Dynamic DNS (ddclient), FTP (vsftpd), UPS monitoring (NUT), OpenVPN client/server, SNMP

**System** -- Services control, hostname/timezone/NTP, package updates, journalctl log viewer, email alerts, config export/import, TrueNAS migration, browser-based web shell

**Security** -- JWT auth with HTTP-only cookies, TOTP 2FA, role-based access (admin/user), audit logging

**UI** -- Dark mode, collapsible sidebar, drag-and-drop dashboard, configurable polling interval

## Quick Start

Run the one-liner on a fresh Ubuntu/Debian x86_64 host (8 GB+ RAM):

```bash
curl -fsSL https://raw.githubusercontent.com/midyear66/Truebuntu/main/install.sh | sudo bash
```

This installs all host dependencies (Docker, ZFS, Samba, NFS, Chrony, smartmontools, rclone, netplan), clones the repo to `/opt/truebuntu`, generates a `.env` with a random secret key, and starts the container.

Once complete, open `http://<your-server-ip>` in a browser and create your admin account.

<details>
<summary>Manual install</summary>

1. Clone the repository:
   ```bash
   git clone https://github.com/midyear66/Truebuntu.git /opt/truebuntu
   cd /opt/truebuntu
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

### Reference: TrueNAS Mini

This project was built and tested on TrueNAS Mini hardware running Ubuntu:

| Model         | CPU                        | RAM         | Drive Bays |
|---------------|----------------------------|-------------|------------|
| Mini           | Intel Atom C2558 (4-core) | 8 GB ECC    | 5 hot-swap |
| Mini X+        | Intel Atom C3558 (4-core) | 8 GB ECC    | 5 hot-swap |
| Mini XL+       | Intel Atom C3558 (4-core) | 16 GB ECC   | 7+1 hot-swap |
| Mini R         | Intel Xeon D (8-core)     | 32 GB ECC   | 12 hot-swap |

These low-power Atom/Xeon-D systems are ideal targets -- install Ubuntu Server, import your existing ZFS pools, and run Truebuntu.

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

The container runs in **privileged mode** with **host network and PID namespace** to directly manage ZFS pools, system services, disks, and file sharing on the host.

### Host Volume Mounts

| Mount                | Purpose                        |
|----------------------|--------------------------------|
| `/etc/samba`         | SMB share configuration        |
| `/etc/exports`       | NFS export configuration       |
| `/etc/passwd` (ro)   | System user enumeration        |
| `/etc/shadow`        | Password management            |
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
| Auth     | JWT (python-jose), bcrypt, pyotp    |
| Runtime  | Docker, Docker Compose              |

## Configuration

The `.env` file controls runtime settings. Copy `.env.example` to `.env` before starting.

| Variable        | Default                       | Description                                      |
|-----------------|-------------------------------|--------------------------------------------------|
| `SECRET_KEY`    | `change-me-to-a-random-string`| Secret used to sign JWT tokens. Generate with `openssl rand -hex 24`. |
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
| system           | `/system`           | Hostname, timezone, NTP settings    |
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
