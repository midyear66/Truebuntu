"""Tests for the zpool/zfs output parsers.

These parsers turn CLI text into the structures the dashboard and pool pages
render, so a misread here shows the operator a healthy pool that is actually
degraded. Fixtures are real command output, kept verbatim including the tab and
space indentation zpool uses — which is what parse_vdev_tree() depends on.
"""
from backend.utils import zfs


# --- fixtures: real command output ------------------------------------------

# A healthy two-mirror pool with a spare and a log device. zpool status indents
# with a leading tab, then two spaces per level.
STATUS_HEALTHY = """  pool: tank
 state: ONLINE
  scan: scrub repaired 0B in 02:14:31 with 0 errors on Sun Aug 10 03:14:32 2026
config:

\tNAME            STATE     READ WRITE CKSUM
\ttank            ONLINE       0     0     0
\t  mirror-0      ONLINE       0     0     0
\t    sda         ONLINE       0     0     0
\t    sdb         ONLINE       0     0     0
\t  mirror-1      ONLINE       0     0     0
\t    sdc         ONLINE       0     0     0
\t    sdd         ONLINE       0     0     0
\tlogs
\t  nvme0n1       ONLINE       0     0     0
\tspares
\t  sde           AVAIL

errors: No known data errors
"""

STATUS_DEGRADED = """  pool: tank
 state: DEGRADED
status: One or more devices could not be used because the label is missing.
  scan: resilver in progress since Fri Aug 21 09:12:03 2026
\t1.23T scanned at 512M/s, 890G issued at 371M/s, 2.40T total
\t148G resilvered, 36.20% done, 01:23:45 to go
config:

\tNAME            STATE     READ WRITE CKSUM
\ttank            DEGRADED     0     0     0
\t  mirror-0      DEGRADED     0     0     0
\t    sda         ONLINE       0     0     0
\t    sdb         FAULTED      0     0    17  too many errors

errors: No known data errors
"""


# --- parse_vdev_tree ---------------------------------------------------------

def test_vdev_tree_nests_disks_under_their_vdev():
    tree = zfs.parse_vdev_tree(STATUS_HEALTHY)
    names = [node["name"] for node in tree]
    assert names == ["mirror-0", "mirror-1", "logs", "spares"]

    mirror0 = tree[0]
    assert mirror0["type"] == "vdev"
    assert mirror0["state"] == "ONLINE"
    assert [c["name"] for c in mirror0["children"]] == ["sda", "sdb"]
    assert all(c["type"] == "disk" for c in mirror0["children"])


def test_vdev_tree_marks_sections_and_their_members():
    tree = zfs.parse_vdev_tree(STATUS_HEALTHY)
    sections = {node["name"]: node for node in tree if node["type"] == "section"}
    assert set(sections) == {"logs", "spares"}
    assert [c["name"] for c in sections["logs"]["children"]] == ["nvme0n1"]
    assert [c["name"] for c in sections["spares"]["children"]] == ["sde"]


def test_vdev_tree_preserves_error_counts_and_states():
    tree = zfs.parse_vdev_tree(STATUS_DEGRADED)
    mirror = tree[0]
    assert mirror["state"] == "DEGRADED"
    faulted = [c for c in mirror["children"] if c["name"] == "sdb"][0]
    assert faulted["state"] == "FAULTED"
    assert faulted["cksum"] == "17"


def test_vdev_tree_handles_output_with_no_config_section():
    assert zfs.parse_vdev_tree("  pool: tank\n state: ONLINE\n") == []
    assert zfs.parse_vdev_tree("") == []


# --- parse_scan_progress -----------------------------------------------------

def test_scan_progress_is_none_when_nothing_is_running():
    assert zfs.parse_scan_progress("") is None
    assert zfs.parse_scan_progress(
        "scrub repaired 0B in 02:14:31 with 0 errors on Sun Aug 10 03:14:32 2026"
    ) is None


def test_scan_progress_reads_an_active_resilver():
    scan = (
        "resilver in progress since Fri Aug 21 09:12:03 2026\n"
        "\t1.23T scanned at 512M/s, 890G issued at 371M/s, 2.40T total\n"
        "\t148G resilvered, 36.20% done, 01:23:45 to go"
    )
    progress = zfs.parse_scan_progress(scan)
    assert progress is not None
    assert progress["operation"] == "resilver"
    assert progress["percent"] == 36.20
    assert progress["eta"] == "01:23:45"
    assert progress["speed"] == "512M/s"
    assert progress["total"] == "2.40T"


def test_scan_progress_reads_the_legacy_resilver_format():
    """ZFS before 0.8 put the number on the other side of each keyword."""
    scan = (
        "resilver in progress since Fri Aug 21 09:12:03 2026\n"
        "\t890G scanned out of 2.40T at 371M/s, 01:23:45 to go"
    )
    progress = zfs.parse_scan_progress(scan)
    assert progress["total"] == "2.40T"
    assert progress["scanned"] == "890G"
    assert progress["eta"] == "01:23:45"


def test_scan_progress_distinguishes_scrub_from_resilver():
    scan = "scrub in progress since Fri Aug 21 09:12:03 2026\n\t5.00% done, 00:10:00 to go"
    progress = zfs.parse_scan_progress(scan)
    assert progress["operation"] == "scrub"
    assert progress["percent"] == 5.00


def test_scan_progress_reports_estimating_before_an_eta_exists():
    scan = "resilver in progress since Fri Aug 21 09:12:03 2026\n\t0.00% done, no estimated completion time"
    progress = zfs.parse_scan_progress(scan)
    assert progress["eta"] == "estimating..."


def test_scan_progress_omits_zero_repair():
    zero = zfs.parse_scan_progress(
        "scrub in progress since Fri Aug 21 09:12:03 2026\n\trepaired 0B, 1.00% done"
    )
    assert zero["repaired"] == ""

    some = zfs.parse_scan_progress(
        "scrub in progress since Fri Aug 21 09:12:03 2026\n\trepaired 1.5G, 1.00% done"
    )
    assert some["repaired"] == "1.5G"


# --- _format_bytes -----------------------------------------------------------

def test_format_bytes_scales_units():
    assert zfs._format_bytes(512) == "512B"
    assert zfs._format_bytes(1024) == "1.0K"
    assert zfs._format_bytes(1024 ** 3) == "1.0G"
    assert zfs._format_bytes(4 * 1024 ** 4) == "4.0T"


def test_format_bytes_tolerates_junk():
    assert zfs._format_bytes(None) == ""
    assert zfs._format_bytes("not a number") == ""


# --- tab-separated list parsers ---------------------------------------------

def _stub_run(monkeypatch, stdout, ok=True):
    """Replace zfs.run() with one that returns canned command output."""
    class Result:
        def __init__(self):
            self.stdout = stdout
            self.stderr = "" if ok else "command failed"
            self.returncode = 0 if ok else 1
            self.ok = ok

    monkeypatch.setattr(zfs, "run", lambda *a, **kw: Result())


def test_parse_zpool_list_maps_columns(monkeypatch):
    _stub_run(monkeypatch, "tank\t7.25T\t3.10T\t4.15T\t2%\t42%\tONLINE\n")
    pools = zfs.parse_zpool_list()
    assert pools == [{
        "name": "tank",
        "size": "7.25T",
        "allocated": "3.10T",
        "free": "4.15T",
        "fragmentation": "2%",
        "capacity": "42%",
        "health": "ONLINE",
    }]


def test_parse_zpool_list_is_empty_when_the_command_fails(monkeypatch):
    _stub_run(monkeypatch, "", ok=False)
    assert zfs.parse_zpool_list() == []


def test_parse_zfs_list_handles_optional_trailing_columns(monkeypatch):
    _stub_run(
        monkeypatch,
        "tank\t3.10T\t4.15T\t200K\t/tank\tlz4\tnone\n"
        "tank/media\t2.00T\t4.15T\t2.00T\t/tank/media\n",
    )
    datasets = zfs.parse_zfs_list()
    assert len(datasets) == 2
    assert datasets[0]["compression"] == "lz4"
    assert datasets[0]["quota"] == "none"
    # The short row must still parse, just without the optional keys.
    assert datasets[1]["name"] == "tank/media"
    assert "compression" not in datasets[1]


def test_parse_zfs_get_builds_a_property_map(monkeypatch):
    _stub_run(monkeypatch, "compression\tlz4\nrecordsize\t128K\n")
    assert zfs.parse_zfs_get("tank", ["compression", "recordsize"]) == {
        "compression": "lz4",
        "recordsize": "128K",
    }


def test_parse_zfs_get_keeps_values_containing_tabs_intact(monkeypatch):
    # split("\t", 1) means only the first tab separates property from value.
    _stub_run(monkeypatch, "comment\thello\tworld\n")
    assert zfs.parse_zfs_get("tank", ["comment"]) == {"comment": "hello\tworld"}


def test_list_recent_snapshots_splits_name_and_respects_limit(monkeypatch):
    rows = "".join(
        f"tank/media@auto-2026-08-{day:02d}\t10K\t2.00T\tThu Aug {day} 00:00 2026\n"
        for day in range(1, 11)
    )
    _stub_run(monkeypatch, rows)

    snaps = zfs.list_recent_snapshots(limit=4)
    assert len(snaps) == 4
    assert snaps[0]["dataset"] == "tank/media"
    assert snaps[0]["snapshot"] == "auto-2026-08-01"
    assert snaps[0]["name"] == "tank/media@auto-2026-08-01"


def test_list_recent_snapshots_tolerates_a_name_without_an_at_sign(monkeypatch):
    _stub_run(monkeypatch, "tank\t10K\t2.00T\tThu Aug 1 00:00 2026\n")
    snaps = zfs.list_recent_snapshots()
    assert snaps[0]["dataset"] == "tank"
    assert snaps[0]["snapshot"] == ""


def test_get_pool_mountpoints_normalises_trailing_slash(monkeypatch):
    _stub_run(monkeypatch, "/tank\n/backup/\nnone\n-\n")
    assert zfs.get_pool_mountpoints() == {"/tank/", "/backup/"}
