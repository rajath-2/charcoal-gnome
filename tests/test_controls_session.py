"""Exercise the control wheel through GNOME Shell 51 in an isolated session."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='charcoal-controls-test-'))
for name in ['runtime', 'cache', 'config/charcoal/themes', 'data/gnome-shell/modes']:
    (root / name).mkdir(parents=True)
(root / 'runtime').chmod(0o700)
extensions = root / 'data/gnome-shell/extensions'
for name in ['charcoal-themes@local', 'charcoal-controls@local']:
    shutil.copytree(repo / 'extensions' / name, extensions / name)
    subprocess.run(['glib-compile-schemas', '--strict', str(extensions / name / 'schemas')], check=True)
fixture = extensions / 'controls-test@local'
fixture.mkdir()
shutil.copyfile(repo / 'tests/controls-session.js', fixture / 'extension.js')
(fixture / 'metadata.json').write_text(json.dumps({'uuid': 'controls-test@local', 'name': 'Controls test',
    'description': 'Isolated checks', 'shell-version': ['51'], 'session-modes': ['user', 'controls-test']}))
(root / 'data/gnome-shell/modes/controls-test.json').write_text(json.dumps({'parentMode': 'user',
    'enabledExtensions': ['charcoal-themes@local', 'charcoal-controls@local', 'controls-test@local'],
    'hasOverview': False, 'showWelcomeDialog': False}))
(root / 'config/charcoal/themes/night.json').write_text(json.dumps({'version': 1, 'id': 'night',
    'name': 'Night', 'wallpaper': None, 'components': {'controls': {'radius': 180}}}))
env = dict(os.environ, XDG_DATA_HOME=str(root / 'data'), XDG_CONFIG_HOME=str(root / 'config'),
    XDG_DATA_DIRS=f"{root / 'data'}:/usr/local/share:/usr/share", XDG_CACHE_HOME=str(root / 'cache'),
    XDG_RUNTIME_DIR=str(root / 'runtime'), XDG_STATE_HOME=str(root / 'state'), GSETTINGS_BACKEND='memory')
for key in ['WAYLAND_DISPLAY', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']:
    env.pop(key, None)
print(f'Session artifacts: {root}', flush=True)
with (root / 'shell.log').open('w') as log:
    process = subprocess.Popen(['dbus-run-session', '--', 'gnome-shell', '--headless', '--wayland', '--no-x11',
        '--virtual-monitor=1280x720', '--mode=controls-test'], env=env, stdout=log,
        stderr=subprocess.STDOUT, start_new_session=True)
    try:
        process.wait(timeout=40)
    finally:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
output = (root / 'shell.log').read_text()
if 'CONTROLS PASS' not in output or 'CONTROLS FAIL' in output:
    raise AssertionError(output[-14000:])
print('CONTROLS PASS')
