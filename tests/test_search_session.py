"""Open the Minimal search style in an isolated headless GNOME Shell 51 session."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='charcoal-search-test-'))
for name in ['runtime', 'cache', 'config', 'data/gnome-shell/modes']:
    (root / name).mkdir(parents=True)
(root / 'runtime').chmod(0o700)
extensions = root / 'data/gnome-shell/extensions'
for name in ['blur-my-shell@aunetx', 'charcoal-launchers@local']:
    shutil.copytree(repo / 'extensions' / name, extensions / name)
    subprocess.run(['glib-compile-schemas', '--strict', str(extensions / name / 'schemas')], check=True)
fixture = extensions / 'search-test@local'
fixture.mkdir()
shutil.copyfile(repo / 'tests/search-session.js', fixture / 'extension.js')
(fixture / 'metadata.json').write_text(json.dumps({'uuid': 'search-test@local', 'name': 'Search test',
    'description': 'Isolated checks', 'shell-version': ['51'], 'session-modes': ['user', 'search-test']}))
(root / 'data/gnome-shell/modes/search-test.json').write_text(json.dumps({'parentMode': 'user',
    'enabledExtensions': ['blur-my-shell@aunetx', 'charcoal-launchers@local', 'search-test@local'],
    'hasOverview': False, 'showWelcomeDialog': False}))
# Set before dbus-run-session: nothing in the session may reach the real dconf.
env = dict(os.environ, XDG_DATA_HOME=str(root / 'data'), XDG_CONFIG_HOME=str(root / 'config'),
    XDG_DATA_DIRS=f"{root / 'data'}:/usr/local/share:/usr/share", XDG_CACHE_HOME=str(root / 'cache'),
    XDG_RUNTIME_DIR=str(root / 'runtime'), XDG_STATE_HOME=str(root / 'state'), GSETTINGS_BACKEND='memory')
for key in ['WAYLAND_DISPLAY', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']:
    env.pop(key, None)
print(f'Session artifacts: {root}', flush=True)
with (root / 'shell.log').open('w') as log:
    process = subprocess.Popen(['dbus-run-session', '--', 'gnome-shell', '--headless', '--wayland', '--no-x11',
        '--virtual-monitor=1280x720', '--mode=search-test'], env=env, stdout=log,
        stderr=subprocess.STDOUT, start_new_session=True)
    try:
        process.wait(timeout=60)
    finally:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
output = (root / 'shell.log').read_text()
if 'SEARCH PASS' not in output or 'SEARCH FAIL' in output:
    raise AssertionError(output[-14000:])
print('SEARCH PASS')
