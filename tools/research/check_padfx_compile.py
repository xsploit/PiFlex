"""Syntax-check changed C++ against an existing Linux build's dependency flags.

Does not modify that build or its source checkout. Not a link/runtime test.
"""
import json
import pathlib
import shlex
import subprocess
import sys
import tempfile
import os
import shutil

root = pathlib.Path(__file__).resolve().parents[2]
build = pathlib.Path(sys.argv[1])
commands = json.loads((build / 'compile_commands.json').read_text())
for name, template in [
    ('src/preferences/padfxsettings.cpp', 'src/preferences/systemsettings.cpp'),
    ('src/coreservices.cpp', 'src/coreservices.cpp'),
    ('src/effects/backends/builtin/echoeffect.cpp', 'src/effects/backends/builtin/echoeffect.cpp'),
    ('src/effects/backends/builtin/builtinbackend.cpp', 'src/effects/backends/builtin/builtinbackend.cpp'),
    ('src/effects/chains/padeffectchain.cpp', 'src/effects/chains/quickeffectchain.cpp'),
    ('src/effects/effectsmanager.cpp', 'src/effects/effectsmanager.cpp'),
    ('src/effects/visibleeffectslist.cpp', 'src/effects/visibleeffectslist.cpp'),
    ('src/engine/effects/engineeffectchain.cpp', 'src/engine/effects/engineeffectchain.cpp'),
]:
    if '--harness-only' in sys.argv:
        continue
    entry = next(c for c in commands if c['file'].endswith('/' + template))
    old_root = entry['file'][:-len(template)-1]
    args = shlex.split(entry['command'].replace(old_root, str(root)))
    # Remove output/dependency-generation switches, retaining actual build flags.
    cleaned = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ('-o', '-MF', '-MT', '-MQ'):
            i += 2
            continue
        if arg not in ('-c', '-MD', '-MMD') and not arg.endswith('/' + template):
            cleaned.append(arg)
        i += 1
    cleaned += ['-fsyntax-only', str(root / name)]
    print(name, flush=True)
    # The cached build's moc includes its old source header by relative path.
    # Generate current metadata in isolation instead of mixing two class definitions.
    with tempfile.TemporaryDirectory(prefix='piflex-moc-check-') as moc_dir:
        if name == 'src/coreservices.cpp':
            subprocess.run(['/usr/lib/qt6/libexec/moc',
                            *[arg for arg in cleaned if arg.startswith('-D')],
                            '-I' + str(root / 'src'), str(root / 'src/coreservices.h'),
                            '-o', str(pathlib.Path(moc_dir) / 'moc_coreservices.cpp')], check=True)
            cleaned.insert(1, '-I' + moc_dir)
        subprocess.run(cleaned, cwd=entry['directory'], check=True)

if any(option in sys.argv for option in ('--audio', '--settings', '--skin')):
    entry = next(c for c in commands if c['file'].endswith('/src/effects/backends/builtin/echoeffect.cpp'))
    old_root = entry['file'][:-len('/src/effects/backends/builtin/echoeffect.cpp')]
    args = shlex.split(entry['command'].replace(old_root, str(root)))
    flags = []
    i = 1  # compiler
    while i < len(args):
        if args[i] in ('-o', '-MF', '-MT', '-MQ'):
            i += 2
            continue
        if args[i] not in ('-c', '-MD', '-MMD') and not args[i].endswith('.cpp'):
            flags.append(args[i])
        i += 1
    # Reuse dependency libraries only; compile the current Echo and harness.
    make_link = build / 'CMakeFiles/mixxx.dir/link.txt'
    if make_link.exists():
        link = shlex.split(make_link.read_text())
        libraries = link[link.index('libmixxx-lib.a'):]
    else:
        lines = subprocess.check_output(['ninja', '-t', 'commands', 'mixxx'], cwd=build, text=True).splitlines()
        link = shlex.split(lines[-1])
        libraries = link[link.index('libmixxx-lib.a'):link.index('&&', link.index('libmixxx-lib.a'))]
    flags += shlex.split(subprocess.check_output(['pkg-config', '--cflags', 'Qt6Test'], text=True))
    libraries += shlex.split(subprocess.check_output(['pkg-config', '--libs', 'Qt6Test'], text=True))
    with tempfile.TemporaryDirectory(prefix='piflex-padfx-test-') as temp:
        cases = []
        if '--audio' in sys.argv:
            cases.append(('echo', 'src/effects/backends/builtin/echoeffect.cpp', 'os/tests/padecho_audio_test.cpp'))
        if '--settings' in sys.argv:
            cases.append(('settings', 'src/preferences/padfxsettings.cpp', 'os/tests/padfx_settings_test.cpp'))
        if '--skin' in sys.argv:
            cases.append(('skin', 'src/preferences/padfxsettings.cpp', 'os/tests/padfx_skin_test.cpp'))
        for label, source, harness in cases:
            executable = pathlib.Path(temp) / (label + '-test')
            extra_sources = [str(root / 'src/skin/legacy/legacyskinparser.cpp')] if label == 'skin' else []
            if label == 'skin':
                subprocess.run(['/usr/lib/qt6/libexec/moc', *[f for f in flags if f.startswith('-D')],
                                '-I' + str(root / 'src'), str(root / 'src/skin/legacy/legacyskinparser.h'),
                                '-o', str(pathlib.Path(temp) / 'moc_legacyskinparser.cpp')], check=True)
            subprocess.run([args[0], '-I' + temp, *flags, *extra_sources, str(root / source), str(root / harness),
                            '-o', str(executable), *libraries], cwd=build, check=True)
            if label == 'skin':
                output = []
                if '--screenshot' in sys.argv:
                    output = [sys.argv[sys.argv.index('--screenshot') + 1]]
                debugger = ['gdb', '-batch', '-ex', 'run', '-ex', 'bt', '--args'] if '--gdb' in sys.argv else []
                display = ['xvfb-run', '-a'] if shutil.which('xvfb-run') else []
                env = os.environ.copy()
                if not display:
                    env['QT_QPA_PLATFORM'] = 'offscreen'
                subprocess.run([*display, *debugger, str(executable), str(root), *output], cwd=build, env=env, check=True)
            else:
                subprocess.run([str(executable)], cwd=build, check=True)
