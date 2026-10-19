"""Operator-only Btrfs staging. Never rewrites the database or removes sources.

Run on the Unraid host, not in a privileged container. Apply requires explicit
project IDs. Sources must be quiescent before a later cutover; staging is not a
live synchronization service.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import time
import uuid


def canonical_directory(value):
    p = Path(value)
    if not p.is_absolute() or p.is_symlink() or p.resolve(strict=True) != p or not p.is_dir():
        raise ValueError("Expected a canonical absolute directory")
    return p


def uuid_string(value):
    if str(uuid.UUID(value)) != value:
        raise ValueError("Expected a canonical UUID")
    return value


def inventory(root):
    """Reject links/devices/mounts rather than dereferencing or importing them."""
    root = canonical_directory(root)
    device = root.stat().st_dev
    records = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            p = Path(directory) / name
            info = p.lstat()
            relative = p.relative_to(root).as_posix()
            if info.st_dev != device or stat.S_ISLNK(info.st_mode):
                raise ValueError("A source contains a link or nested filesystem")
            if stat.S_ISDIR(info.st_mode):
                records[relative] = {"type": "directory"}
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                # Recheck identity after reading. Quiescence is still required.
                fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as stream:
                    opened = os.fstat(stream.fileno())
                    if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                        raise ValueError("Source replaced before reading")
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                after = p.lstat()
                if (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise ValueError("Source changed during inventory")
                records[relative] = {"type": "file", "bytes": info.st_size, "sha256": digest, "executable": bool(info.st_mode & 0o111)}
            else:
                raise ValueError("A source contains a hardlink or special file")
    return records


def plan(connection, source_root, destination, project_ids):
    source_root = canonical_directory(source_root)
    destination = canonical_directory(destination)
    if source_root == destination or source_root in destination.parents or destination in source_root.parents:
        raise ValueError("Source and destination storage must be disjoint")
    connection.row_factory = sqlite3.Row
    projects = []
    roots = []
    for project_id in sorted(set(project_ids)):
        uuid_string(project_id)
        row = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise ValueError("Unknown project")
        workspaces = []
        for workspace in connection.execute("SELECT id, path FROM project_workspaces WHERE project_id = ? ORDER BY id", (project_id,)):
            workspace_id = uuid_string(workspace["id"])
            logical = Path(workspace["path"])
            if not logical.is_absolute() or '..' in logical.parts or not logical.is_relative_to('/workspaces') or logical == Path('/workspaces'):
                raise ValueError("Only explicitly mapped /workspaces sources are supported")
            source = canonical_directory(source_root / logical.relative_to('/workspaces'))
            if not source.is_relative_to(source_root) or source == source_root:
                raise ValueError("Workspace escaped the source mount")
            if any(source == other or source in other.parents or other in source.parents for other in roots):
                raise ValueError("Overlapping workspace sources")
            roots.append(source)
            target = destination / project_id / workspace_id
            records = inventory(source)
            workspaces.append({"id": workspace_id, "oldPath": workspace["path"], "source": str(source), "target": str(target),
                "futureApplicationPath": f"/project-workspaces/{project_id}/{workspace_id}",
                "futureWorkerPath": f"/workspaces/{project_id}/{workspace_id}", "inventory": records})
        if not workspaces:
            raise ValueError("Project has no workspaces")
        projects.append({"id": project_id, "subvolume": str(destination / project_id), "workspaces": workspaces})
    if not projects:
        raise ValueError("Explicit project selection is required")
    return {"version": 1, "createdAt": int(time.time()), "phase": "planned", "databaseChanged": False,
            "originalsPreserved": True, "standardAgentsEnabled": False, "projects": projects}


def prepare(migration, destination):
    if os.geteuid() != 0:
        raise ValueError("Host administrator required to provision Btrfs subvolumes")
    destination = canonical_directory(destination)
    if destination.name != 'workspaces' or destination.parent.name != 'standard-worker':
        raise ValueError("Expected dedicated standard-worker/workspaces storage")
    btrfs = shutil.which('btrfs')
    if not btrfs:
        raise ValueError("Btrfs tools unavailable; no ordinary-directory fallback")
    filesystem = subprocess.check_output(['findmnt', '--noheadings', '--output', 'FSTYPE', '--target', str(destination)], text=True).strip()
    if filesystem != 'btrfs':
        raise ValueError("Dedicated storage is not on Btrfs")
    subprocess.run([btrfs, 'inspect-internal', 'rootid', str(destination)], check=True, stdout=subprocess.DEVNULL)
    for project in migration['projects']:
        if Path(project['subvolume']).exists():
            raise ValueError("Destination already exists; never overwrite or merge a staged project")
    # The executor may edit workspace contents, never replace project boundaries.
    os.chown(destination, 0, 0)
    os.chmod(destination, 0o755)
    for project in migration['projects']:
        subvolume = Path(project['subvolume'])
        subprocess.run([btrfs, 'subvolume', 'create', str(subvolume)], check=True, stdout=subprocess.DEVNULL)
        # Admin application can manage workspace directories; the executor can
        # traverse known paths but cannot create/replace workspace siblings.
        os.chown(subvolume, 0, 11002)
        os.chmod(subvolume, 0o771)
        root_id = subprocess.check_output([btrfs, 'inspect-internal', 'rootid', str(subvolume)], text=True).strip()
        project['subvolumeId'] = int(root_id)
        for workspace in project['workspaces']:
            source, target = Path(workspace['source']), Path(workspace['target'])
            if inventory(source) != workspace['inventory']:
                raise ValueError("Source changed; retain staged files for inspection and abort")
            shutil.copytree(source, target, symlinks=True)  # Never follow a symlink introduced during copying.
            if inventory(target) != workspace['inventory'] or inventory(source) != workspace['inventory']:
                raise ValueError("Copy verification failed; no database change was made")
            for directory, dirs, files in os.walk(target):
                for p in [Path(directory)] + [Path(directory) / f for f in files]:
                    executable = bool(p.stat().st_mode & 0o111)
                    os.chown(p, 11003, 11002)
                    os.chmod(p, 0o770 if p.is_dir() else (0o770 if executable else 0o660))
            if inventory(target) != workspace['inventory']:
                raise ValueError("Post-permission content verification failed")
    migration['phase'] = 'staged-not-active'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--project-id', action='append', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    manifest = Path(args.manifest)
    # Reserve the audit file before creating storage; never replace an old report.
    fd = os.open(manifest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    connection = None
    migration = None
    try:
        connection = sqlite3.connect(Path(args.database).resolve(strict=True).as_uri() + '?mode=ro', uri=True)
        connection.execute('BEGIN')
        migration = plan(connection, args.source_root, args.destination, args.project_id)
        if args.prepare:
            prepare(migration, args.destination)
        with os.fdopen(fd, 'w') as stream:
            fd = None
            json.dump(migration, stream, ensure_ascii=False, indent=2)
        print(json.dumps({"phase": migration['phase'], "projects": len(migration['projects']),
            "workspaces": sum(len(p['workspaces']) for p in migration['projects']), "databaseChanged": False, "originalsPreserved": True}))
    except Exception:
        if fd is not None and migration is not None:
            migration['phase'] = 'failed-staging-retained'
            with os.fdopen(fd, 'w') as stream:
                fd = None
                json.dump(migration, stream, ensure_ascii=False, indent=2)
        raise
    finally:
        if connection is not None:
            connection.close()
        if fd is not None:
            os.close(fd)


if __name__ == '__main__':
    main()
