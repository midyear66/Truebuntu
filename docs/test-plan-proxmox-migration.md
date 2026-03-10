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

### 4.3 Verify Pool Health

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
| SMB shares | Clients can read/write after share recreation |
| Web UI | All Truebuntu pages load, no console errors |
| SMART | Disk health data accessible |

## Notes

- Proxmox virtio disks work fine with ZFS — no passthrough needed for testing
- For production hardware (TrueNAS Mini), use SATA/SAS passthrough instead of virtio
- The TrueNAS VM is kept until all validation passes as a rollback option
- **Always `zpool export` before detaching disks** from any VM — this writes clean metadata and prevents "potentially active" errors on the next import
