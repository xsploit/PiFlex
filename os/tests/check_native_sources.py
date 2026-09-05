"""Syntax-check current sources using an existing compatible Linux Qt build.

Usage: python3 check_native_sources.py /path/to/build/compile_commands.json
Does not rebuild or modify that build. Repository include paths are redirected
to THIS checkout; generated configuration headers still come from the build.
This is a compile check, not a complete application build or runtime test.
"""
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
database = json.loads(Path(sys.argv[1]).read_text())
sources = ['src/library/edmc/edmcfeature.cpp',
           'src/library/rekordbox/rekordboxfeature.cpp',
           'src/preferences/systemsettings.cpp',
           'src/track/track.cpp',
           'src/widget/woverview.cpp']
if len(sys.argv) > 2:
    sources = sys.argv[2:]
for relative in sources:
    entry = next(e for e in database if e['file'].endswith('/'+relative))
    old_root = entry['file'][:-len(relative)-1]
    args = shlex.split(entry['command'])
    clean = []
    cursor = 0
    while cursor < len(args):
        arg = args[cursor]
        if arg in ['-o', '-MF', '-MT', '-MQ']:
            cursor += 2
            continue
        if arg not in ['-c', '-MD', '-MMD']:
            clean.append(arg.replace(old_root, str(ROOT)))
        cursor += 1
    print('Checking current checkout:', relative, flush=True)
    # Old moc files include headers from their original checkout. Regenerate
    # these into a private directory instead of mixing two class definitions.
    with tempfile.TemporaryDirectory(prefix='pflx-moc-check-') as directory:
        header = ROOT/Path(relative).with_suffix('.h')
        generated = Path(directory)/('moc_'+header.stem+'.cpp')
        subprocess.run(['/usr/lib/qt6/libexec/moc', str(header),
                        '-I'+str(ROOT/'src'), '-o', str(generated)], check=True)
        clean = [clean[0], '-I'+directory, *clean[1:], '-fsyntax-only']
        subprocess.run(clean, cwd=entry['directory'], check=True)
