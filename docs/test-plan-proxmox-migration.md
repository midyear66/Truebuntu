# Test Plan: TrueNAS → Truebuntu Migration on Proxmox

## Objective

Validate the full migration path: create a TrueNAS VM on Proxmox with a 4-disk ZFS pool, populate it with data, then replace it with a Truebuntu (Ubuntu) VM that inherits the same pool.

---

## Phase 1: Proxmox Setup

### 1.1 Create TrueNAS VM

- [ ] Download TrueNAS Core ISO (or TrueNAS SCALE if preferred)
- [ ] Create a new VM with a boot disk:
  - OS: FreeBSD (Core) or Linux (SCALE)
  - CPU: 2 cores
  - RAM: 8 GB
  - Boot disk: 32 GB virtio

### 1.2 Create and Attach Data Disks

- [ ] Add 4 x 20 GB virtual disks to the TrueNAS VM:
  ```bash
  qm set <truenas-vmid> --scsi1 <storage>:20
  qm set <truenas-vmid> --scsi2 <storage>:20
  qm set <truenas-vmid> --scsi3 <storage>:20
  qm set <truenas-vmid> --scsi4 <storage>:20
  ```
  > Replace `<storage>` with your Proxmox storage name (e.g., `local-lvm`). The `:20` allocates 20 GB. Adjust the bus (`scsi1`-`scsi4`) if `scsi0` is already used by the boot disk.
- [ ] Verify all disks are attached:
  ```bash
  qm config <truenas-vmid> | grep scsi
  ```

### 1.3 Install TrueNAS

- [ ] Install TrueNAS onto the boot disk
- [ ] Verify TrueNAS boots and web UI is accessible

---

## Phase 2: TrueNAS Configuration

### 2.1 Create ZFS Pool

- [ ] In TrueNAS web UI, create a pool using the 4 disks (e.g., raidz1 or mirror+mirror)
- [ ] Note the pool name and layout

### 2.2 Populate Test Data

- [ ] Create 2-3 datasets on the pool
- [ ] Create an SMB share on at least one dataset
- [ ] Write test files to the share from a client (mix of small and large files)
- [ ] Create a snapshot of each dataset
- [ ] Record checksums of test files for later verification:
  ```bash
  find /mnt/<pool>/<dataset> -type f -exec sha256sum {} \; > /tmp/checksums.txt
  ```

### 2.3 Export TrueNAS Config (Optional)

- [ ] Export TrueNAS config backup from System → General → Save Config
- [ ] Save the config file — Truebuntu has a TrueNAS migration endpoint (`/api/migrate`)

### 2.4 Record Pool State

- [ ] SSH into TrueNAS and save pool info:
  ```bash
  zpool status
  zpool list
  zfs list
  zfs list -t snapshot
  ```
- [ ] Screenshot or save the output for comparison

---

## Phase 3: Shutdown TrueNAS, Create Truebuntu VM

### 3.1 Shutdown TrueNAS

- [ ] **Export the ZFS pool** before shutting down (this ensures clean metadata):
  ```bash
  sudo zpool export <pool-name>
  ```
- [ ] Cleanly shut down the TrueNAS VM from the web UI or `shutdown -p now`
- [ ] In Proxmox, detach the 4 data disks from the TrueNAS VM using `qm set --delete`:
  ```bash
  # List current disks on the TrueNAS VM to identify the data disks
  qm config <truenas-vmid>

  # Detach each data disk (keeps the volume, only removes it from the VM config)
  # Adjust scsi1-scsi4 (or virtio1-virtio4) to match your disk bus assignments
  qm set <truenas-vmid> --delete scsi1
  qm set <truenas-vmid> --delete scsi2
  qm set <truenas-vmid> --delete scsi3
  qm set <truenas-vmid> --delete scsi4
  ```
  > **Note:** `qm set --delete` only removes the disk from the VM configuration — it does **not** delete the underlying volume. The disk images remain on the Proxmox storage and can be reattached to another VM.
- [ ] Do **not** delete the TrueNAS VM yet (keep for rollback)

### 3.2 Create Ubuntu VM

- [ ] Download Ubuntu Server 22.04 or 24.04 LTS ISO
- [ ] Create a new VM:
  - OS: Linux
  - CPU: 2 cores
  - RAM: 8 GB
  - Boot disk: 32 GB virtio
- [ ] Attach the 4 data disks from the TrueNAS VM to the new Ubuntu VM:
  ```bash
  # Find the detached disk volume names (they'll show as "unused" in the TrueNAS VM config)
  qm config <truenas-vmid> | grep unused

  # Attach each disk to the Ubuntu VM (adjust storage:volume names to match)
  qm set <ubuntu-vmid> --scsi1 <storage>:vm-<truenas-vmid>-disk-1
  qm set <ubuntu-vmid> --scsi2 <storage>:vm-<truenas-vmid>-disk-2
  qm set <ubuntu-vmid> --scsi3 <storage>:vm-<truenas-vmid>-disk-3
  qm set <ubuntu-vmid> --scsi4 <storage>:vm-<truenas-vmid>-disk-4
  ```
  > Replace `<storage>` with your Proxmox storage name (e.g., `local-lvm`) and adjust disk numbers to match. You can also attach disks via the Proxmox web UI under Hardware → Add → Existing Disk.
- [ ] Install Ubuntu Server onto the boot disk
  - Enable OpenSSH server
  - Do **not** format the 4 data disks
- [ ] Reboot into Ubuntu and verify SSH access

---

## Phase 4: Install Truebuntu and Import Pool

### 4.1 Install Truebuntu

- [ ] SSH into the Ubuntu VM
- [ ] Run the install script:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/midyear66/Truebuntu/main/install.sh | sudo bash
  ```
- [ ] Verify the container starts and the web UI is accessible at `http://<vm-ip>`

### 4.2 Import ZFS Pool

- [ ] Install ZFS if not already present:
  ```bash
  sudo apt update && sudo apt install -y zfsutils-linux
  ```
- [ ] Scan for available pools (should show the exported pool):
  ```bash
  sudo zpool import
  ```
- [ ] Import the pool:
  ```bash
  sudo zpool import <pool-name>
  ```
- [ ] If the pool does not appear, scan by disk ID:
  ```bash
  sudo zpool import -d /dev/disk/by-id
  ```
- [ ] If the pool was not cleanly exported (skipped `zpool export` in Phase 3.1), force the import:
  ```bash
  sudo zpool import -f <pool-name>
  ```
  > **Note:** Always prefer a clean export. Only use `-f` if the pool shows as "potentially active" or "was not cleanly exported."

### 4.3 Pre-Migration: Users, Groups, and Permissions

Before importing the TrueNAS config, create the system users and groups that match the TrueNAS UID/GID ownership on the pool. This ensures file permissions work immediately after import.

#### Gather Ownership Info from TrueNAS

- [ ] On TrueNAS (before shutdown), record the share ownership and critical groups:
  ```bash
  ls -la /mnt/<pool>/
  getent group family   # or any custom groups used by shares
  getent passwd plex    # or any service accounts
  ```

#### Create Groups on Ubuntu

- [ ] Create groups that match TrueNAS GIDs. If a GID is already taken (e.g., GID 101 = `lxd` on Ubuntu), create the group with an auto-assigned GID and remap file ownership after pool import:
  ```bash
  # Check if the TrueNAS GID is available
  getent group 101  # if taken (e.g., lxd), skip -g flag

  # Option A: GID is available — create with matching GID
  sudo groupadd -g 101 family

  # Option B: GID is taken — create with auto GID, remap after import
  sudo groupadd family
  ```
- [ ] Verify:
  ```bash
  getent group family
  ```

#### Remap File Ownership (if GIDs differ)

- [ ] If any groups were created with a different GID than TrueNAS, remap ownership after pool import:
  ```bash
  # Find files owned by the old TrueNAS GID and chgrp to the new group
  sudo find /<pool> -group 101 -exec chgrp family {} +
  ```
  > **Note:** This can take a while on large pools. Run it per-dataset for faster feedback:
  > ```bash
  > sudo chgrp -R family /<pool>/Family /<pool>/Photo /<pool>/Video
  > ```

#### Create Service Accounts on Ubuntu

- [ ] Create service accounts with matching UIDs/GIDs:
  ```bash
  # Example: plex (UID 972, GID 972 on TrueNAS)
  sudo groupadd -g 972 plex
  sudo useradd -u 972 -g 972 -m -s /bin/bash plex
  sudo passwd plex
  ```

#### Add Users to Groups

- [ ] Add users to the appropriate groups:
  ```bash
  sudo usermod -aG family sanford
  ```

#### Verify Permissions After Pool Import

- [ ] After the pool is imported, verify share ownership transferred correctly:
  ```bash
  ls -la /<pool>/
  ```
  - Owners should show usernames (not numeric UIDs) if UID/GID mapping is correct
  - If you see numeric IDs instead of names, the corresponding user/group is missing — create it with the matching ID
- [ ] Check for extended ACLs (POSIX or NFSv4):
  ```bash
  sudo apt install -y nfs4-acl-tools
  for dir in /<pool>/*/; do
    echo "=== $dir ==="
    nfs4_getfacl "$dir" 2>/dev/null || echo "(no NFSv4 ACLs)"
  done
  ```
  > **Note:** Most TrueNAS home setups use standard POSIX permissions (owner/group/mode), not NFSv4 ACLs. If `nfs4_getfacl` returns empty results, permissions are purely POSIX and will work on Linux without any conversion.

### 4.4 Verify Pool Health

- [ ] Confirm pool status:
  ```bash
  zpool status
  zpool list
  zfs list
  zfs list -t snapshot
  ```
- [ ] Compare output against Phase 2.4 — pool name, layout, datasets, and snapshots should all match

---

## Phase 5: Truebuntu Validation

### 5.1 Web UI — Pool and Datasets

- [ ] Open Truebuntu web UI and create admin account
- [ ] Navigate to Storage → Pools — verify the imported pool appears
- [ ] Navigate to Datasets — verify all datasets are listed
- [ ] Navigate to Snapshots — verify snapshots from TrueNAS are visible

### 5.2 Data Integrity

- [ ] Verify test file checksums match:
  ```bash
  cd /mnt/<pool>/<dataset>
  sha256sum -c /path/to/checksums.txt
  ```
- [ ] Browse files via SMB after recreating the share in Truebuntu

### 5.3 Share Recreation

- [ ] Create SMB shares in Truebuntu pointing to the same dataset paths
- [ ] Connect from a client and verify read/write access
- [ ] Verify file permissions are intact

### 5.4 TrueNAS Config Migration (Optional)

- [ ] Upload the TrueNAS config backup via the Truebuntu migration endpoint
- [ ] Verify that shares, users, or other settings are imported

### 5.5 General Functionality

- [ ] Dashboard loads with pool stats, CPU, memory, temperatures
- [ ] Create a new snapshot from Truebuntu UI
- [ ] Delete a test snapshot from Truebuntu UI
- [ ] Verify disk health / SMART data is visible
- [ ] Test dark mode and sidebar GitHub link

### 5.6 Alert Services

#### Configure Services

- [ ] Navigate to System → Alerts
- [ ] Configure SMTP and send a test email
- [ ] Add a **Slack** alert service (create a test channel with an [Incoming Webhook](https://api.slack.com/messaging/webhooks))
- [ ] Add a **Pushover** alert service (sign up at pushover.net for a free 30-day trial)
- [ ] Add a **Webhook** alert service pointing to a request catcher (e.g., [webhook.site](https://webhook.site))
- [ ] Click **Test** on each service — verify notifications arrive
- [ ] Disable a service, click Test again — verify it does NOT fire
- [ ] Re-enable and verify it fires again

#### Enable Alert Categories

- [ ] Enable all alert category checkboxes and save
- [ ] Verify saved settings persist after page reload

#### Simulate Cron Job Failure

- [ ] Create a cron job with a command that will fail:
  ```
  Name: Test Failure Alert
  Command: /bin/false
  Schedule: (use CronPicker — select "Hourly" or run manually)
  ```
- [ ] Click "Run Now" on the job
- [ ] Verify alerts arrive on email + all enabled services
- [ ] Check the Jobs page for the failed job with exit code 1

#### Simulate Rsync Task Failure

- [ ] Create an rsync task pointing to a non-existent remote host:
  ```
  Source: /tmp
  Remote Host: 192.0.2.1 (RFC 5737 TEST-NET — guaranteed unreachable)
  Remote Path: /tmp
  ```
- [ ] Run the task — it should fail with a connection timeout
- [ ] Verify rsync failure alerts arrive

#### Simulate S.M.A.R.T. Test Failure

> Note: SMART test failures are hard to simulate on virtual disks since Proxmox virtio disks don't support SMART. If testing on physical hardware:

- [ ] Schedule a short SMART test on a disk
- [ ] Run it and verify completion (will likely pass on healthy hardware)
- [ ] To force an alert, temporarily modify the test to target a non-existent disk:
  - Create a SMART test with disk `sdz` (doesn't exist)
  - Run it — smartctl will fail, triggering the alert

#### Simulate Replication Failure

- [ ] Create a replication task pointing to an unreachable host:
  ```
  Source Dataset: <pool>/<dataset>
  Destination Host: 192.0.2.1
  Destination Dataset: test/backup
  ```
- [ ] Run the task — SSH connection will fail
- [ ] Verify replication failure alerts arrive

#### Simulate ZFS Alerts

**Scrub failure:**
- [ ] Enable the "ZFS Failures" alert category
- [ ] Run a scrub on the pool from the UI (Storage → Pools → Scrub)
- [ ] On a healthy pool this will succeed (no alert) — to force a scrub alert, temporarily detach a disk before scrubbing:
  ```bash
  # On the Proxmox host, hot-remove a data disk from the VM (simulates disk failure)
  qm set <ubuntu-vmid> --delete scsi4
  ```
- [ ] The pool should enter DEGRADED state — verify the dashboard triggers a **pool degraded** alert
- [ ] Start a scrub while degraded — if it reports errors, a **scrub failure** alert should fire

**Pool capacity warning (80%+):**
- [ ] Create a small test pool to make it easy to fill:
  ```bash
  # Create 2 x 100MB files to use as vdevs
  dd if=/dev/zero of=/tmp/vdev1 bs=1M count=100
  dd if=/dev/zero of=/tmp/vdev2 bs=1M count=100
  sudo zpool create testpool mirror /tmp/vdev1 /tmp/vdev2
  ```
- [ ] Fill it past 80%:
  ```bash
  sudo dd if=/dev/urandom of=/testpool/bigfile bs=1M count=85
  ```
- [ ] Reload the dashboard — verify a **capacity warning** alert fires
- [ ] Clean up:
  ```bash
  sudo zpool destroy testpool
  rm /tmp/vdev1 /tmp/vdev2
  ```

**Dedup verification:**
- [ ] After a pool degraded alert fires, reload the dashboard several times
- [ ] Verify only **one** alert is sent (not one per dashboard poll)
- [ ] Fix the pool (reattach the disk, `zpool online <pool> <disk>`, resilver)
- [ ] Once the pool returns to ONLINE, degrade it again
- [ ] Verify a **new** alert fires (dedup resets when condition clears)

### 5.7 Cloud Credentials

- [ ] Navigate to Accounts → Cloud Credentials
- [ ] Create a **Backblaze B2** credential — click Test, verify success
- [ ] Create an **Amazon S3** credential (or S3-compatible like MinIO/Wasabi) — click Test
- [ ] Create an **SFTP** credential pointing to the VM itself (`localhost`, port 22) — click Test
- [ ] Create a **WebDAV** credential if a WebDAV server is available — click Test
- [ ] For OAuth providers (Google Drive, Dropbox, OneDrive), verify the form shows the authorization note
- [ ] Delete a credential — verify it's removed from the list
- [ ] View credential details — verify sensitive keys are masked

### 5.8 Cloud Sync Tasks with Bucket Auto-Load

- [ ] Navigate to Tasks → Cloud Sync
- [ ] Create a new task and select a B2 or S3 credential from the dropdown
- [ ] Verify the **bucket dropdown** auto-populates with available buckets
- [ ] Select "Other (enter manually)..." — verify a manual text input appears
- [ ] Complete the task setup and click "Run Now"
- [ ] Verify files transfer (check Jobs page for success/failure)

### 5.9 Visual Cron Scheduler (CronPicker)

Test the CronPicker component on all 5 pages that use it:

- [ ] **Cron Jobs** — create a job, verify preset buttons work (Hourly, Daily, Weekly, Monthly)
- [ ] **Rsync Tasks** — create a task, click "Custom", use the 5-field dropdowns
- [ ] **S.M.A.R.T. Tests** — verify the cron string updates live below the picker
- [ ] **Snapshot Tasks** — verify the old preset dropdown is gone, replaced by CronPicker
- [ ] **Cloud Sync** — verify CronPicker renders in the task form

For each page:
- [ ] Select a preset → verify the cron string matches (e.g., "Daily (midnight)" = `0 0 * * *`)
- [ ] Click "Custom" → change minute to 30, hour to 2 → verify string shows `30 2 * * *`
- [ ] Save the task → reload → verify the schedule persisted correctly
- [ ] Edit the task → verify CronPicker initializes with the saved value

### 5.10 VLANs

- [ ] Navigate to Network → Interfaces → VLANs tab
- [ ] Click "Create VLAN"
- [ ] Set VLAN ID to `100`, select a parent interface, leave DHCP enabled
- [ ] Click "Create VLAN" — verify it appears in the table
- [ ] Verify on the host that netplan was applied:
  ```bash
  cat /etc/netplan/99-truebuntu.yaml  # should contain a vlans: section
  ip link show  # should show vlan100 interface
  ```
- [ ] Delete the VLAN — verify it's removed from the table and netplan
- [ ] Test with static IP: create VLAN 200, uncheck DHCP, enter `10.0.200.1/24`
- [ ] Verify the interface gets the static IP:
  ```bash
  ip addr show vlan200
  ```
- [ ] Clean up by deleting the test VLANs

---

## Upgrading Truebuntu During Testing

If a new version is pushed to the repository while testing is in progress:

```bash
# SSH into the Ubuntu VM
ssh sanford@<vm-ip>

# Pull the latest changes
cd ~/truebuntu
sudo git pull

# Rebuild and restart the container (data volume is preserved)
sudo docker compose up -d --build
```

> **Note:** The SQLite database lives on a Docker named volume (`nas-data:/data`) and ZFS pools are on the host — neither is affected by a rebuild. Any pending database schema migrations run automatically on startup.

If you need to pin a specific version or branch:

```bash
cd ~/truebuntu
sudo git fetch --all
sudo git checkout <branch-or-tag>
sudo docker compose up -d --build
```

---

## Phase 6: Cleanup

- [ ] If all tests pass, delete the TrueNAS VM from Proxmox
- [ ] Optionally snapshot the Ubuntu/Truebuntu VM as a known-good baseline

---

## Pass Criteria

| Check | Criteria |
|-------|----------|
| Pool import | Pool imports without errors, same layout as TrueNAS |
| Datasets | All datasets and properties preserved |
| Snapshots | All TrueNAS snapshots visible and intact |
| Data integrity | All file checksums match |
| File permissions | Share ownership shows usernames (not numeric UIDs); `ls -la` matches TrueNAS |
| SMB shares | Clients can read/write after share recreation |
| Web UI | All Truebuntu pages load, no console errors |
| SMART | Disk health data accessible |
| Alert services | Test notifications arrive on all configured services (email, Slack, Pushover, webhook) |
| Alert categories | Simulated failures (cron, rsync, replication, ZFS) trigger alerts to all enabled services |
| Alert dedup | Pool degraded/capacity alerts fire once, not on every dashboard poll |
| Cloud credentials | Create, test, and delete credentials for at least 3 provider types |
| Cloud sync buckets | Bucket dropdown auto-populates when selecting a credential |
| CronPicker | Presets and custom mode work on all 5 task pages; saved schedules persist |
| VLANs | Create and delete VLANs; netplan applied correctly; interfaces visible on host |

## Notes

- Proxmox virtio disks work fine with ZFS — no passthrough needed for testing
- For production hardware (TrueNAS Mini), use SATA/SAS passthrough instead of virtio
- The TrueNAS VM is kept until all validation passes as a rollback option
- **Always `zpool export` before detaching disks** from any VM — this writes clean metadata and prevents "potentially active" errors on the next import
