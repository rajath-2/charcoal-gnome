"""Run the topbar integration checks in an isolated GNOME 51 headless session."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
from PIL import Image

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix="charcoal-topbar-test-"))
for name in ["runtime", "cache", "config", "data/gnome-shell/modes"]:
    (root / name).mkdir(parents=True)
(root / "runtime").chmod(0o700)
extensions = root / "data/gnome-shell/extensions"
for name in ["charcoal-topbar@local", "blur-my-shell@aunetx"]:
    shutil.copytree(repo / "extensions" / name, extensions / name)
    subprocess.run(["glib-compile-schemas", "--strict", str(extensions / name / "schemas")], check=True)
fixture = extensions / "topbar-test@local"
fixture.mkdir()
shutil.copyfile(repo / "tests/topbar-session.js", fixture / "extension.js")
(fixture / "metadata.json").write_text(json.dumps({
    "uuid": "topbar-test@local", "name": "Topbar test", "description": "Isolated checks",
    "shell-version": ["50", "51"], "session-modes": ["user", "topbar-test"],
}))
(root / "data/gnome-shell/modes/topbar-test.json").write_text(json.dumps({
    "parentMode": "user", "enabledExtensions": ["charcoal-topbar@local", "topbar-test@local"],
    "hasOverview": False, "showWelcomeDialog": False,
}))
env = dict(os.environ, XDG_DATA_HOME=str(root / "home"), XDG_CONFIG_HOME=str(root / "config"),
           XDG_DATA_DIRS=f"{root / 'data'}:/usr/local/share:/usr/share",
           XDG_CACHE_HOME=str(root / "cache"), XDG_RUNTIME_DIR=str(root / "runtime"),
           XDG_STATE_HOME=str(root / "state"), GSETTINGS_BACKEND="memory")
for key in ["WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS"]:
    env.pop(key, None)
print(f"Session artifacts: {root}", flush=True)
with (root / "shell.log").open("w") as log:
    process = subprocess.Popen(["dbus-run-session", "--", "gnome-shell", "--headless", "--wayland", "--no-x11",
                    "--virtual-monitor=1280x720", "--mode=topbar-test"],
                   env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        process.wait(timeout=40)
    finally:
        # Also stop descendants if a test or GNOME itself hangs.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
output = (root / "shell.log").read_text()
if "TOPBAR PASS" not in output or "TOPBAR FAIL" in output:
    raise AssertionError(output[-14000:])
geometry = json.loads((root / "cache/icon.json").read_text())
x, y = map(round, geometry["position"])
w, h = map(round, geometry["size"])
icon = Image.open(root / "cache/topbar.png").convert("RGB").crop((x, y, x + w, y + h))
assert icon.getpixel((w // 2, h // 2)) == (255, 96, 64), "full-color texture did not render in theme color"
assert icon.getpixel((0, 0)) != (255, 96, 64), "tint filled transparent icon corners"
print("TOPBAR PASS: nested styles, dynamic actors, preferences, cleanup, and icon tint")
