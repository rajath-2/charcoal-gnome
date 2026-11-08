"""Map GNOME Shell 51 lock actors in an isolated headless session."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='charcoal-lockscreen-test-'))
for name in ['runtime', 'cache', 'config', 'data/gnome-shell/modes']:
    (root / name).mkdir(parents=True)
(root / 'runtime').chmod(0o700)
extensions = root / 'data/gnome-shell/extensions'
shutil.copytree(repo / 'extensions/charcoal-lockscreen@local', extensions / 'charcoal-lockscreen@local')
subprocess.run(['glib-compile-schemas', '--strict', str(extensions / 'charcoal-lockscreen@local/schemas')], check=True)
fixture = extensions / 'lockscreen-test@local'
fixture.mkdir()
shutil.copyfile(repo / 'tests/lockscreen-session.js', fixture / 'extension.js')
(fixture / 'metadata.json').write_text(json.dumps({'uuid': 'lockscreen-test@local', 'name': 'Lock screen test',
    'description': 'Isolated checks', 'shell-version': ['51'], 'session-modes': ['user', 'unlock-dialog', 'lockscreen-test']}))
(root / 'data/gnome-shell/modes/lockscreen-test.json').write_text(json.dumps({'parentMode': 'user',
    'enabledExtensions': ['lockscreen-test@local'], 'hasOverview': False, 'showWelcomeDialog': False}))
env = dict(os.environ, XDG_DATA_HOME=str(root / 'data'), XDG_CONFIG_HOME=str(root / 'config'),
    XDG_DATA_DIRS=f"{root / 'data'}:/usr/local/share:/usr/share", XDG_CACHE_HOME=str(root / 'cache'),
    XDG_RUNTIME_DIR=str(root / 'runtime'), XDG_STATE_HOME=str(root / 'state'), GSETTINGS_BACKEND='memory')
for key in ['WAYLAND_DISPLAY', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']:
    env.pop(key, None)
print(f'Session artifacts: {root}', flush=True)
with (root / 'shell.log').open('w') as log:
    process = subprocess.Popen(['dbus-run-session', '--', 'gnome-shell', '--headless', '--wayland', '--no-x11',
        '--virtual-monitor=1280x720', '--mode=lockscreen-test'], env=env, stdout=log,
        stderr=subprocess.STDOUT, start_new_session=True)
    try:
        process.wait(timeout=40)
    finally:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
output = (root / 'shell.log').read_text()
if 'LOCKSCREEN PASS' not in output or 'LOCKSCREEN FAIL' in output:
    raise AssertionError(output[-14000:])
print('LOCKSCREEN PASS')
