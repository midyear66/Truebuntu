# Truebuntu

A self-hosted NAS management web UI for Ubuntu-based ZFS storage servers.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)
![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB.svg)
![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)

## Features

**Storage** -- ZFS pool creation (mirror, raidz, raidz2, raidz3, stripe), datasets, snapshots, snapshot policies, ZFS replication, disk replace/spare/attach

**Sharing** -- SMB shares with per-share permissions and session view, NFS exports with client access lists

**Monitoring** -- SMART health and scheduled tests, disk temperatures, enclosure view with pool mapping

**Tasks** -- Cron jobs, rsync backups, resilver priority windows, init/shutdown scripts, cloud sync via rclone

**Networking** -- Interface configuration (DHCP/static), network bonds (LACP, active-backup, etc.), DNS and routing table

**System** -- Services control, hostname/timezone/NTP, package updates, journalctl log viewer, email alerts, config export/import, TrueNAS migration

**Security** -- JWT auth with HTTP-only cookies, TOTP 2FA, role-based access (admin/user), audit logging

**UI** -- Dark mode, collapsible sidebar, drag-and-drop dashboard, configurable polling interval

## Quick Start

Run the one-liner on a fresh Ubuntu/Debian x86_64 host (8 GB+ RAM):

```bash
curl -fsSL https://raw.githubusercontent.com/midyear66/trubuntu/main/install.sh | sudo bash
```

This installs all host dependencies (Docker, ZFS, Samba, NFS, Chrony, smartmontools, rclone, netplan), clones the repo to `/opt/truebuntu`, generates a `.env` with a random secret key, and starts the container.

Once complete, open `http://<your-server-ip>` in a browser and create your admin account.

<details>
<summary>Manual install</summary>

1. Clone the repository:
   ```bash
   git clone https://github.com/midyear66/trubuntu.git /opt/truebuntu
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
│                    │  ...26 router modules      │  │
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
| shares           | `/shares`           | SMB share management                |
| nfs              | `/nfs`              | NFS export management               |
| disks            | `/disks`            | Disk SMART and temperature          |
| enclosure        | `/enclosure`        | Hardware enclosure view             |
| users            | `/users`            | Unix user and group management      |
| services         | `/services`         | Systemd service control             |
| system           | `/system`           | Hostname, timezone, NTP settings    |
| updates          | `/updates`          | System package updates              |
| network          | `/network`          | Interface, bond, DNS, route mgmt   |
| replication      | `/replication`      | ZFS send/receive replication tasks  |
| logs             | `/logs`             | Journalctl log viewer               |
| alerts           | `/alerts`           | SMTP config and alert categories    |
| tasks            | `/tasks`            | Generic scheduled tasks             |
| cron_jobs        | `/cron-jobs`        | Cron job scheduling                 |
| rsync_tasks      | `/rsync-tasks`      | Rsync backup tasks                  |
| smart_tests      | `/smart-tests`      | SMART test scheduling               |
| resilver         | `/resilver`         | Resilver priority configuration     |
| init_shutdown    | `/init-shutdown`    | Startup/shutdown scripts            |
| rclone           | `/rclone`           | Cloud sync remote management        |
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
