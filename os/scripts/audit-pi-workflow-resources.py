"""Read-only normalized baseline audit before updating installed resources."""
from pathlib import Path
import hashlib
import json
import shlex
import subprocess
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backup', help='Verified installed-resource backup from the staging step')
args = parser.parse_args()
previous = {}
if args.backup:
    if not args.backup.startswith('/home/pompu_5/bitedj-before-rekordbox-') or '/' in args.backup.removeprefix('/home/pompu_5/'):
        raise SystemExit('Expected a scoped staging backup directory')
    archive_probe = ('import tarfile,hashlib,json;t=tarfile.open(' + repr(args.backup+'/resources.tgz') + ');'
        'print(json.dumps({m.name:hashlib.sha256(t.extractfile(m).read().replace(b"\\r\\n",b"\\n")).hexdigest() '
        'for m in t.getmembers() if m.isfile()}))')
    previous = json.loads(subprocess.check_output(['ssh','-o','BatchMode=yes','-o',
        'StrictHostKeyChecking=yes','pflx-pi','python3 -c '+shlex.quote(archive_probe)],text=True))

root = Path(__file__).resolve().parents[2]
names = subprocess.check_output(['git', 'diff', '--name-only', '--', 'res'], cwd=root).decode().splitlines()
targets = {name: '/usr/local/share/mixxx/' + name.removeprefix('res/') for name in names}
for name in names:
    if name.startswith('res/controllers/'):
        targets['profile:' + name] = '/home/pompu_5/.mixxx/controllers/' + Path(name).name
probe = ('import pathlib,json,hashlib;targets=' + repr(targets) + ';'
         'print(json.dumps({n:hashlib.sha256(pathlib.Path(p).read_bytes().replace(b"\\r\\n",b"\\n")).hexdigest() '
         'for n,p in targets.items()}))')
remote = json.loads(subprocess.check_output(['ssh', '-o', 'BatchMode=yes', '-o',
    'StrictHostKeyChecking=yes', 'pflx-pi', 'python3 -c ' + shlex.quote(probe)], text=True))
conflicts = []
for name, remote_hash in remote.items():
    source = name.removeprefix('profile:')
    baseline = subprocess.check_output(['git', 'show', 'HEAD:' + source], cwd=root)
    current = (root/source).read_bytes()
    accepted = [hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest() for data in (baseline, current)]
    # An earlier uncommitted build may be the legitimate installed baseline.
    # Never assume it: compare against the verified pre-build resource archive.
    archive_name = 'mixxx/' + source.removeprefix('res/')
    if archive_name in previous:
        accepted.append(previous[archive_name])
    if remote_hash not in accepted:
        conflicts.append(name)
print(json.dumps({'checked': list(targets.values()), 'conflicts': conflicts}, indent=2))
raise SystemExit(bool(conflicts))
