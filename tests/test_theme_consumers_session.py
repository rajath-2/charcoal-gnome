"""Exercise theme values through actual GNOME 51 extension instances."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix="charcoal-theme-consumers-test-"))
for name in ["runtime", "cache", "config/charcoal/themes", "data/gnome-shell/modes"]:
    (root / name).mkdir(parents=True)
(root / "runtime").chmod(0o700)
extensions = root / "data/gnome-shell/extensions"
for name in ["blur-my-shell@aunetx", "charcoal-themes@local", "charcoal-launchers@local",
             "charcoal-appearance@local", "charcoal-topbar@local", "charcoal-widgets@local"]:
    shutil.copytree(repo / "extensions" / name, extensions / name)
    subprocess.run(["glib-compile-schemas", "--strict", str(extensions / name / "schemas")], check=True)
fixture = extensions / "theme-consumers-test@local"
fixture.mkdir()
shutil.copyfile(repo / "tests/theme-consumers-session.js", fixture / "extension.js")
(fixture / "metadata.json").write_text(json.dumps({
    "uuid": "theme-consumers-test@local", "name": "Theme consumers test", "description": "Isolated checks",
    "shell-version": ["51"], "session-modes": ["user", "theme-consumers-test"],
}))
(root / "data/gnome-shell/modes/theme-consumers-test.json").write_text(json.dumps({
    "parentMode": "user", "enabledExtensions": ["blur-my-shell@aunetx", "charcoal-themes@local",
                                          "charcoal-launchers@local", "charcoal-appearance@local",
                                          "charcoal-topbar@local", "charcoal-widgets@local",
                                          "theme-consumers-test@local"],
    "hasOverview": False, "showWelcomeDialog": False,
}))
(root / "config/charcoal/themes/night.json").write_text(json.dumps({
    "version": 1, "id": "night", "name": "Night", "wallpaper": None,
    "components": {"launchers": {"wheel-radius": 180, "launcher-width": 800},
                   "appearance": {"icon-theme": "Adwaita"},
                   "topbar": {"bar-height": 42}, "widgets": {"background-color": "#112233",
                                                           "positions": '{"music":{"monitor":0,"x":0.2,"y":0.3}}'}},
}))
env = dict(os.environ, XDG_DATA_HOME=str(root / "data"), XDG_CONFIG_HOME=str(root / "config"),
           XDG_DATA_DIRS=f"{root / 'data'}:/usr/local/share:/usr/share", XDG_CACHE_HOME=str(root / "cache"),
           XDG_RUNTIME_DIR=str(root / "runtime"), XDG_STATE_HOME=str(root / "state"), GSETTINGS_BACKEND="memory")
for key in ["WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS"]:
    env.pop(key, None)
print(f"Session artifacts: {root}", flush=True)
with (root / "shell.log").open("w") as log:
    process = subprocess.Popen(["dbus-run-session", "--", "gnome-shell", "--headless", "--wayland", "--no-x11",
                                "--virtual-monitor=1280x720", "--mode=theme-consumers-test"],
                               env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        process.wait(timeout=40)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
output = (root / "shell.log").read_text()
if "THEME CONSUMERS PASS" not in output or "THEME CONSUMERS FAIL" in output:
    raise AssertionError(output[-14000:])
print("THEME CONSUMERS PASS")
