# Truebuntu

A self-hosted NAS management web UI for Ubuntu-based ZFS storage servers. Provides a TrueNAS-like experience with a modern React frontend and Python FastAPI backend, all deployed via Docker.

## Features

### Storage Management
- **ZFS Pools** -- Create, scrub, and manage pools (mirror, raidz, raidz2, raidz3, stripe) with spare, log, and cache vdev support. Disk replacement, online/offline, and detach operations included.
- **Datasets** -- Full CRUD with property management (compression, quota, atime, etc.)
- **Snapshots** -- Create, rollback, clone, and delete snapshots manually or via automated snapshot policies with configurable retention and scheduling.
- **ZFS Replication** -- Schedule incremental ZFS send/receive to remote hosts over SSH with per-task configuration.

### File Sharing
- **SMB/Samba** -- Create and manage shares with per-share permissions, browsability, guest access, and read-only toggles. View active sessions.
- **NFS** -- Configure exports with client access lists and live reload.

### Disk & Hardware Monitoring
- **SMART Health** -- View disk health, temperature, and power-on hours. Schedule periodic SMART tests (short, long, conveyance, offline).
- **Enclosure View** -- Visual hardware overview with disk-to-pool mapping and health indicators.

### Task Automation
- **Cron Jobs** -- Schedule arbitrary shell commands with configurable timeouts.
- **Rsync Tasks** -- Local or SSH-based rsync backups with archive, compress, and delete options.
- **Resilver Priority** -- Configure ZFS resilver priority windows by time-of-day and weekday.
- **Init/Shutdown Scripts** -- Run custom scripts at system startup or shutdown (pre/post).

### Cloud Sync
- **Rclone Integration** -- Configure and test cloud remotes (S3, Google Drive, Dropbox, etc.) for cloud sync tasks.

### Networking
- **Interfaces** -- View and configure network interfaces with DHCP or static IP, MTU, and DNS settings.
- **Bonds** -- Create and manage network bonds (LACP, active-backup, balance-alb, etc.) with member interface selection.
- **DNS & Routes** -- View system DNS servers, search domains, and routing table.

### System Administration
- **Users & Groups** -- Create and manage Unix users with integrated Samba password sync.
- **Services** -- Start, stop, restart, enable, and disable system services (Samba, NFS, SSH, Docker, ZFS ZED, Chrony, smartmontools, Zabbix Agent).
- **System Settings** -- Configure hostname, timezone, and NTP servers (chrony).
- **Updates** -- Check for and apply system package updates via apt.
- **System Logs** -- Real-time journalctl log viewer with unit, priority, and line count filtering, plus optional auto-refresh.
- **Email Alerts** -- SMTP configuration with test email and per-category alert toggles (cron, rsync, SMART, replication failures).
- **Dashboard** -- At-a-glance overview of pools, datasets, snapshots, services, disk temperatures, load average, memory usage, network throughput, and recent snapshots.

### Security
- **JWT Authentication** -- HTTP-only cookie-based sessions with 24-hour expiry.
- **TOTP 2FA** -- Optional two-factor authentication with QR code setup for authenticator apps.
- **Audit Logging** -- All mutations (POST/PUT/DELETE) are logged with timestamp, user, action, resource, and IP address.

### Configuration Management
- **Config Export/Import** -- Backup and restore all settings, policies, tasks, and system config as JSON.
- **TrueNAS Migration** -- Import users, shares, NFS exports, snapshot policies, scrub tasks, and cloud sync from a TrueNAS config tarball.

### UI
- **Dark Mode** -- Class-based dark mode with localStorage persistence and system-preference fallback. Toggle via sun/moon button in the header.
- **Collapsible Sidebar** -- Grouped navigation with expandable sections for Storage, Tasks, System, Sharing, and Accounts.

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18, Vite 6, Tailwind CSS 3.4 |
| Backend  | Python 3.12, FastAPI, Uvicorn       |
| Database | SQLite (aiosqlite, WAL mode)        |
| Auth     | JWT (python-jose), bcrypt, pyotp    |
| Runtime  | Docker, Docker Compose              |

## Prerequisites

- Ubuntu server with ZFS installed
- Docker and Docker Compose
- The host must have the following available: `zpool`, `zfs`, `smartctl`, `rclone`, `systemctl`, `samba`, `nfs-kernel-server`, `chrony`, `netplan`

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/your-user/nas-webui.git
   cd nas-webui
   ```

2. Create a `.env` file:
   ```bash
   SECRET_KEY=your-random-secret-key-here
   LOG_LEVEL=info
   ```

3. Build and run with Docker Compose:
   ```bash
   docker compose up -d --build
   ```

4. Open `http://<your-server-ip>` in a browser and create your admin account.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Docker Container (privileged, host network/pid)  │
│                                                    │
│  ┌────────────┐    ┌───────────────────────────┐  │
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
│                    └───────────────────────────┘  │
│                              │                     │
│                    Host: zfs, samba, nfs, systemd   │
└──────────────────────────────────────────────────┘
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

## API Overview

All endpoints are prefixed with `/api`. Authentication is required for all routes except `/api/auth/*` and `/api/migrate/*`.

| Module           | Prefix              | Description                         |
|------------------|---------------------|-------------------------------------|
| auth             | `/auth`             | Login, setup, session management    |
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

The Vite dev server runs on `http://localhost:5173` and proxies API requests to the backend.

## License

MIT
