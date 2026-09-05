"""Exercise the real updater with all appliance paths redirected into a fixture.

Linux only. No services are controlled: systemctl/getent/sync are fixture stubs.
Never execute the production-path updater from this test.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / 'layer/rootfs-overlay'
FILES = ['usr/local/bin/mixxx', 'usr/local/bin/pflx-bitedj-supervisor',
         'usr/local/bin/start-pflx-edmc', 'usr/local/sbin/pflx-update',
         'usr/local/sbin/pflx-rollback', 'usr/local/sbin/pflx-usb-mount']

class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pflx-update-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.live = self.root / 'appliance'
        for p in ['usr/local/bin', 'usr/local/sbin', 'usr/local/share/mixxx',
                  'opt/pflx/edmc-companion', 'run/lock', 'var/tmp', 'home/pi']:
            (self.live/p).mkdir(parents=True, exist_ok=True)
        for p in FILES:
            (self.live/p).write_text('#!/bin/sh\n# old runtime\n')
        (self.live/'usr/local/share/mixxx/old-skin').write_text('old')
        (self.live/'opt/pflx/edmc-companion/old-module').write_text('old')
        source = (OVERLAY/'usr/local/sbin/pflx-update').read_text()
        # Explicit string substitutions are confined to this generated test copy.
        for prefix in ['/usr/local', '/opt/pflx', '/var/backups/pflx', '/var/tmp', '/run/lock', '/home/']:
            source = source.replace(prefix, str(self.live)+prefix)
        source = source.replace('payload'+str(self.live)+'/', 'payload/')
        source = source.replace('$backup'+str(self.live)+'/', '$backup/')
        source = source.replace('"/$relative', '"'+str(self.live)+'/$relative')
        self.runner = self.root/'updater-under-test'
        self.runner.write_text(source)
        self.stub = self.root/'stubs'; self.stub.mkdir()
        self.log = self.root/'services'
        self.script('systemctl', f'''#!/bin/sh
echo "$*" >> '{self.log}'
case "$1" in show) echo pi;; esac
exit 0
''')
        self.script('getent', f"#!/bin/sh\necho 'pi:x:1000:1000::"+str(self.live)+"/home/pi:/bin/sh'\n")
        self.script('sync', '#!/bin/sh\nexit 0\n')
        self.env = {**os.environ, 'PATH':str(self.stub)+':'+os.environ['PATH']}
        self.archive_root = self.root/'archive'; self.archive_root.mkdir()
        self.payload = self.archive_root/'payload'; self.payload.mkdir()
        for p in FILES:
            dest=self.payload/p; dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_text((OVERLAY/p).read_text() if p!='usr/local/bin/mixxx' else '# new binary fixture\n')
        for p in ['usr/local/share/mixxx/new-skin', 'opt/pflx/edmc-companion/package.json',
                  'opt/pflx/edmc-companion/src/main.mjs',
                  'opt/pflx/edmc-companion/node_modules/playwright-core/package.json']:
            dest=self.payload/p; dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_text('export {};' if p.endswith('.mjs') else '{}')
        (self.archive_root/'manifest.txt').write_text('runtime=pflx-v2\n')
        self.bundle=self.root/'update.tar.gz'

    def script(self,name,text):
        file=self.stub/name; file.write_text(text); file.chmod(0o755)

    def pack(self):
        with tarfile.open(self.bundle,'w:gz') as tar:
            tar.add(self.payload,arcname='payload')
            tar.add(self.archive_root/'manifest.txt',arcname='manifest.txt')
        Path(str(self.bundle)+'.sha256').write_text(hashlib.sha256(self.bundle.read_bytes()).hexdigest()+'  update.tar.gz\n')

    def run_update(self,*args):
        return subprocess.run(['bash',str(self.runner),*(args or [str(self.bundle)])],env=self.env,
                              text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)

    def test_success_then_verified_rollback(self):
        self.pack(); r=self.run_update(); self.assertEqual(r.returncode,0,r.stdout)
        self.assertTrue((self.live/'usr/local/share/mixxx/new-skin').exists())
        self.assertIn('status" -eq 42', (self.live/'usr/local/bin/pflx-bitedj-supervisor').read_text())
        mount_helper=(self.live/'usr/local/sbin/pflx-usb-mount').read_text()
        self.assertNotIn('@PIFLEX_USER@', mount_helper)
        self.assertIn('user=pi', mount_helper)
        backup=(self.live/'var/backups/pflx/latest').resolve()
        r=self.run_update('--rollback',str(backup)); self.assertEqual(r.returncode,0,r.stdout)
        self.assertTrue((self.live/'usr/local/share/mixxx/old-skin').exists())
        self.assertFalse((self.live/'usr/local/share/mixxx/new-skin').exists())
        self.assertIn('old runtime',(self.live/'usr/local/bin/mixxx').read_text())

    def test_failed_backup_never_mutates_installation(self):
        self.script('cp','#!/bin/sh\necho "injected backup failure" >&2\nexit 1\n')
        self.pack(); r=self.run_update(); self.assertNotEqual(r.returncode,0)
        self.assertIn('old runtime',(self.live/'usr/local/bin/mixxx').read_text())
        self.assertFalse((self.live/'var/backups/pflx/latest').exists())
        self.assertNotIn('stop ',self.log.read_text())

    def test_missing_payload_fails_before_backup_or_service_stop(self):
        shutil.rmtree(self.payload/'opt/pflx/edmc-companion')
        self.pack(); r=self.run_update(); self.assertNotEqual(r.returncode,0)
        self.assertFalse((self.live/'var/backups/pflx/latest').exists())
        self.assertNotIn('stop ',self.log.read_text())

    def test_missing_audio_probe_fails_before_changes(self):
        (self.payload/'opt/pflx/edmc-companion/src/audio-probe.mjs').write_text('export {};')
        # Simulate a Pi image without ffprobe without changing the host PATH.
        self.runner.write_text(self.runner.read_text().replace('command -v ffprobe >/dev/null', 'false'))
        self.pack(); r=self.run_update(); self.assertNotEqual(r.returncode,0)
        self.assertIn('requires ffprobe',r.stdout)
        self.assertFalse((self.live/'var/backups/pflx/latest').exists())
        self.assertNotIn('stop ',self.log.read_text())

    def test_failed_install_restores_previous_files(self):
        rsync=shutil.which('rsync')
        self.script('rsync',f'''#!/bin/sh
case "$*" in *'/payload/'*) echo 'injected installation failure' >&2; exit 1;; esac
exec '{rsync}' "$@"
''')
        self.pack(); r=self.run_update(); self.assertNotEqual(r.returncode,0)
        self.assertIn('restoring verified backup',r.stdout)
        self.assertIn('old runtime',(self.live/'usr/local/bin/mixxx').read_text())
        self.assertTrue((self.live/'usr/local/share/mixxx/old-skin').exists())
        self.assertIn('start pflx-session',self.log.read_text())

    def test_symlink_archive_rejected_before_extraction(self):
        (self.payload/'usr/local/share/mixxx/link').symlink_to('/tmp')
        self.pack(); r=self.run_update(); self.assertNotEqual(r.returncode,0)
        self.assertIn('link or special file',r.stdout)
        self.assertNotIn('stop ',self.log.read_text())

if __name__=='__main__':
    unittest.main()
