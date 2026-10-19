"""Prove hardlink boundaries using disposable files on already staged Btrfs projects."""
import argparse
import errno
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    migration = json.loads(Path(args.manifest).read_text())
    if migration.get('phase') != 'staged-not-active' or len(migration['projects']) < 2:
        raise ValueError('Two staged projects are required')
    volumes = [Path(p['subvolume']).resolve(strict=True) for p in migration['projects'][:2]]
    for volume in volumes:
        subprocess.run(['btrfs', 'subvolume', 'show', str(volume)], check=True, stdout=subprocess.DEVNULL)
    scratch = []
    try:
        for parent in [*volumes, volumes[0].parent]:
            scratch.append(Path(tempfile.mkdtemp(prefix='.boundary-probe-', dir=parent)))
        a, b, outside = scratch
        source = a / 'canary'
        source.write_text('BOUNDARY_TEST_ONLY')
        # A successful same-volume control proves this is not just a permission failure.
        os.link(source, a / 'same-project')
        results = {'sameProjectHardlinkWorks': True}
        for name, destination in [('otherProjectHardlinkDenied', b / 'cross-project'), ('outsideProjectHardlinkDenied', outside / 'cross-boundary')]:
            try:
                os.link(source, destination)
            except OSError as error:
                if error.errno != errno.EXDEV:
                    raise
                results[name] = True
            else:
                raise AssertionError('Hardlink crossed project boundary')
        external = outside / 'outside-canary'
        external.write_text('OUTSIDE_TEST_ONLY')
        try:
            os.link(external, a / 'imported-hardlink')
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
            results['outsideHardlinkImportDenied'] = True
        else:
            raise AssertionError('External hardlink entered project')
        results['standardAgentsEnabled'] = False
        print(json.dumps(results))
    finally:
        # Only our mkdtemp-created canary directories, never a project/subvolume.
        for directory in scratch:
            shutil.rmtree(directory)


if __name__ == '__main__':
    main()
