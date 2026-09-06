"""Stage native changes only after a baseline check and a verified Pi backup.

Does not install, restart, or change the running application. Run with --apply
after reviewing its default read-only audit. Existing Pi-only edits are fatal.
"""
from pathlib import Path
import hashlib
import io
import json
import shlex
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--previous-stage', help='Previously verified native.tgz on this Pi')
args = parser.parse_args()

ROOT = Path(__file__).resolve().parents[2]
REMOTE = '/home/pompu_5/bitedj-build-src'
HOST = 'pflx-pi'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def ssh(command):
    return subprocess.check_output(['ssh', '-o', 'BatchMode=yes', '-o',
                                   'ConnectTimeout=8', HOST, command], text=True)

def digest(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()

files = sorted(set(git('diff', '--name-only', '--', 'src', 'res', 'CMakeLists.txt').decode().splitlines()
                   + git('ls-files', '--others', '--exclude-standard', '--', 'src').decode().splitlines()))
if not files:
    raise SystemExit('No native changes to stage.')
for name in files:
    if Path(name).is_absolute() or '..' in Path(name).parts or not (ROOT/name).is_file():
        raise SystemExit('Invalid stage path: '+name)
probe = ('import pathlib,hashlib,json;root=pathlib.Path('+repr(REMOTE)+');'
         'names='+repr(files)+';print(json.dumps({n:hashlib.sha256((root/n).read_bytes()'
         '.replace(b"\\r\\n",b"\\n")).hexdigest() if (root/n).is_file() else None for n in names}))')
remote = json.loads(ssh('python3 -c '+shlex.quote(probe)))
previous = {}
if args.previous_stage:
    if not args.previous_stage.startswith('/home/pompu_5/bitedj-before-rekordbox-') or not args.previous_stage.endswith('/native.tgz'):
        raise SystemExit('Expected a previous stage archive in the scoped backup directory.')
    archive_probe = ('import tarfile,hashlib,json;t=tarfile.open('+repr(args.previous_stage)+');'
                     'print(json.dumps({m.name:hashlib.sha256(t.extractfile(m).read()'
                     '.replace(b"\\r\\n",b"\\n")).hexdigest() for m in t.getmembers() if m.isfile()}))')
    previous = json.loads(ssh('python3 -c '+shlex.quote(archive_probe)))
conflicts = []
payload = {}
for name in files:
    data = (ROOT/name).read_bytes().replace(b'\r\n', b'\n')
    baseline_result = subprocess.run(['git', 'show', 'HEAD:'+name], cwd=ROOT, capture_output=True)
    baseline = digest(baseline_result.stdout) if baseline_result.returncode == 0 else None
    accepted = [baseline, digest(data)]
    if name in previous:
        accepted.append(previous[name])
    if remote[name] not in accepted:
        conflicts.append(name)
    payload[name] = data
print(json.dumps({'files':files, 'conflicts':conflicts}, indent=2), flush=True)
if conflicts:
    raise SystemExit('Pi source differs from baseline; refusing to overwrite it.')
if not args.apply:
    raise SystemExit(0)

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = '/home/pompu_5/bitedj-before-rekordbox-'+stamp
# Stop on any backup failure. Archive source and installed resources as well as
# the exact currently installed executable; installation remains untouched.
print(ssh('set -eu; mkdir '+shlex.quote(backup)+'; tar -czf '+shlex.quote(backup+'/source.tgz')+
          ' -C /home/pompu_5 bitedj-build-src; tar -tzf '+shlex.quote(backup+'/source.tgz')+
          ' >/dev/null; tar -czf '+shlex.quote(backup+'/resources.tgz')+
          ' -C /usr/local/share mixxx; tar -tzf '+shlex.quote(backup+'/resources.tgz')+
          ' >/dev/null; cp /usr/local/bin/mixxx '+shlex.quote(backup+'/mixxx')+
          '; cmp /usr/local/bin/mixxx '+shlex.quote(backup+'/mixxx')+
          '; sha256sum '+shlex.quote(backup+'/mixxx')+'; echo '+shlex.quote(backup)), flush=True)
with tempfile.TemporaryDirectory(prefix='bitedj-pi-stage-') as directory:
    archive = Path(directory)/'native.tgz'
    with tarfile.open(archive, 'w:gz') as tar:
        for name, data in payload.items():
            if remote[name] == digest(data):
                continue # preserve timestamps and completed incremental objects
            info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644
            info.mtime = int(datetime.now(timezone.utc).timestamp())
            tar.addfile(info, io.BytesIO(data))
    remote_archive = backup+'/native.tgz'
    subprocess.run(['scp', '-o', 'BatchMode=yes', str(archive), HOST+':'+remote_archive], check=True)
    remote_hash = ssh('sha256sum '+shlex.quote(remote_archive)).split()[0]
    if remote_hash != hashlib.sha256(archive.read_bytes()).hexdigest():
        raise SystemExit('Stage archive checksum mismatch.')
    ssh('tar -xzf '+shlex.quote(remote_archive)+' -C '+shlex.quote(REMOTE))
actual = json.loads(ssh('python3 -c '+shlex.quote(probe)))
if actual != {name:digest(data) for name,data in payload.items()}:
    raise SystemExit('Staged source verification failed; backup: '+backup)
print('Verified staged native source. Running app unchanged. Backup: '+backup)
