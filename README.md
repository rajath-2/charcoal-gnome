# Charcoal GNOME theme bundle

Personal GNOME **51** setup, packaged as three extensions plus GTK4 styling:

| Extension | What it does | Preferences |
| --- | --- | --- |
| `charcoal-topbar@local` | Top bar and popup styling; auto / compact / islands layout | Layout, static or live blur |
| `charcoal-appearance@local` | GreyStone icons, Future Black cursor, dark style, left window buttons | Icons, cursor, size, style, buttons |
| `charcoal-launchers@local` | Super+Space search and hold-Super favorites wheel | See below |

Each is configured from **Extensions → (name) → Preferences** or
`gnome-extensions prefs <uuid>`. Disabling Charcoal Appearance restores the icon,
cursor, style and button settings you had before. Blur comes from the bundled
Blur My Shell; static blur (wallpaper only, cheap) is the default everywhere, and
live blur can be switched on per extension.

Charcoal Appearance also keeps the GreyStone icons current: once a day it checks
[upstream](https://codeberg.org/StormRosenaa/GreyStone) and, when a newer version is
published, downloads it and swaps it into `~/.local/share/icons` (only after the new
copy is fully extracted). Turn it off or run **Check now** in its preferences.
Re-running `./install.sh` puts back the bundled copy until the next check.

## Install

Clone this repository (or use the existing downloaded folder), then run inside your GNOME session as your normal user:

```bash
git clone https://github.com/rajath-2/gnome-themes.git
cd gnome-themes
```

From the downloaded folder, the equivalent install commands are:

```bash
cd ~/Downloads/gnome-themes
./install.sh --dry-run
./install.sh
```

The default is **automatic** mode: a complete bar when no visible app on the
current workspace/panel monitor is fully maximized; islands when one is maximized.
The controls stay anchored while the background splits/joins. Popup handoffs and
lighter popup blur are included.

Log out and back in after installation. GNOME caches extension JavaScript for the
session, so toggling an extension is not sufficient to load updated code.
Restart open GTK applications to load their CSS. The installer never logs you out.

The layout can be changed any time in Charcoal Topbar's preferences.
`--mode` only picks the starting layout:

```bash
./install.sh --mode compact    # fixed compact floating bar
./install.sh --mode islands    # fixed floating islands
./install.sh --mode auto       # automatic split/join (default)
./install.sh --no-activate     # copy files only, without changing desktop settings
```

Each invocation installs the complete bundle and creates a new backup. The
standalone compact mode retains generous 72px side margins. Automatic mode uses
18px margins in both states so the outer controls remain stationary.

## Included files and destinations

| Bundle | Installed destination |
| --- | --- |
| `gtk-4.0/` | `$XDG_CONFIG_HOME/gtk-4.0` (normally `~/.config/gtk-4.0`) |
| `icons/GreyStone - circle/` | `$XDG_DATA_HOME/icons/GreyStone - circle` |
| `icons/Future-black-cursors/` | `$XDG_DATA_HOME/icons/Future-black-cursors` |
| `extensions/` | `$XDG_DATA_HOME/gnome-shell/extensions/` |

Extensions bundled for offline installation:

- `charcoal-topbar@local`, `charcoal-appearance@local`, `charcoal-launchers@local` (above).
- `blur-my-shell@aunetx`: the exact installed version used with this setup, including
  its popup blur support. Its license and metadata are included.

The top bar no longer needs a Shell theme or the User Themes extension. Installing
moves an older bundle's `adaptive-smoke-panel@local` and `~/.themes/Waybar-GNOME*`
into the backup, and clears a User Themes selection that pointed at them.

Activation enables the four extensions, sets the starting layout, and configures
Blur My Shell: a separate radius-16 popup profile, and static blur for the dock and
windows. Other existing blur profiles are retained. Unrelated extensions remain in
the activation lists. A globally disabled extensions setting is respected.

## Prerequisites and scope

No downloads, root access, or system package changes are required by the script.
Activation requires GNOME Shell 51, Python 3, `gsettings`, `gjs`, and
`glib-compile-schemas`. Other GNOME versions may copy files with `--no-activate`,
but the custom extension and CSS have only been prepared for 51.

`gtk-4.0/gtk.css` is self-contained (header bars and window buttons for GTK4 apps).

`settings.ini` is copied as supplied. It mentions JetBrains Mono, Breeze, and the
Ocean sound theme, which are not included in the supplied folder. They are optional
external dependencies; missing ones may fall back to system defaults. The installer
does not download fonts or those themes, install a GTK3 theme, or alter Flatpak
filesystem permissions. GreyStone's optional inherited icon themes are likewise
not bundled; Adwaita/hicolor provide its system fallbacks.

## Backup and restore

Before replacing any destination, the installer moves its existing contents into:

```text
~/.local/state/gnome-themes/backups/<timestamp>/
```

`XDG_STATE_HOME` is honored. Existing symlinks are backed up as symlinks, without
modifying their targets. Relevant desktop settings are recorded before activation.
The installer prints the exact backup path, including if an installation fails.

Restore the most recent backup first when undoing repeated installations:

```bash
./install.sh --restore '/path/printed/by/the/installer' --dry-run
./install.sh --restore '/path/printed/by/the/installer'
```

Restore replaces installed files with the saved versions and restores the recorded
settings, including the blur profiles and extension activation lists. Files that
did not exist before installation are removed. Use the same user and HOME/XDG
locations used for installation. Log out/in afterward if extensions were active.
A restored backup cannot be restored a second time.

## Verification

```bash
python3 tests/test_installer.py
```

The file-install test uses a temporary home, checks dry run, installation, repeated
installation, symlink preservation, and both restore operations. It does not change
your live desktop settings. Real-session activation is intentionally not run by
the test.

## Search and favorites launchers

- **Super+Space:** centered search for applications, files, calculations, and settings.
- **Tap Super:** workspace overview.
- **Hold Super:** compact favorites wheel at the cursor. Move into a sector and
  release to launch. Release in its center or outside its boundary to cancel.
- **Esc:** cancel. Other Super shortcuts cancel the wheel and retain their action.
- **Window previews:** rest on a running app for a moment to see its windows beside the wheel.
  Move out to them (the app stays selected along its direction) and release on one to bring
  that exact window up. In dock mode, releasing on the focused window minimizes it.
- **Three-finger touchpad:** rest three fingers (same hold delay) to open the wheel at the
  pointer, slide toward an app, and lift to open it. Lifting without sliding cancels. Quick
  three-finger swipes still switch workspaces and open the overview.
- **Radial dock mode** (Preferences): running apps join the wheel as outer rings. Windows
  open out of the cursor, and releasing on the focused app minimizes it into the cursor;
  releasing on it again restores it from there.

Open **Extensions → Charcoal Launchers → Preferences**, or run:

```bash
gnome-extensions prefs charcoal-launchers@local
```

Preferences include favorite apps and order, wheel size/spacing, colors, opacity,
blur (search panel and wheel, static or live), search categories, result limit, shortcut, hold delay, and animation
speed. Defaults use a 240-pixel ring with a transparent center, separate app sectors,
and short fade/scale animations. The wheel's blur follows its sector shapes. The system's
animation setting is respected. Settings survive reinstalling the bundle.

Super+Space normally switches keyboard layouts. The extension temporarily removes
that exact conflict and restores it when disabled. Other shortcut collisions are
reported in Preferences instead of overriding them. Disabling the wheel restores
GNOME's original Super action. Avoid enabling another Super-key remapper alongside
this extension.

File results depend on GNOME Files and its search index; this is not a whole-disk
scan. GNOME Search privacy settings are respected. Calculator and Settings require
their installed GNOME search providers. Enter copies calculation results; ordinary
results open their application or file. Unavailable providers are shown separately.

Additional verification:

```bash
node --test tests/test_launchers.mjs tests/test_topbar.mjs
gjs -m tests/test_icon_update.js    # ICON_UPDATE_NETWORK=1 XDG_DATA_HOME=/tmp/x also downloads
glib-compile-schemas --strict extensions/charcoal-launchers@local/schemas
```

The new UI and gestures were exercised in an isolated GNOME 51.1 Wayland session,
including a focused application, Super+Left, selected/neutral release, Escape,
shortcut conflict rejection, provider responses, Preferences, and blur. Physical
keyboard behavior and mixed-DPI monitors still merit checking after login.

## License

GPL-3.0-or-later; see [LICENSE](LICENSE). Bundled third-party work keeps its own
license and credits, all GPL-3.0:

- [Blur My Shell](https://github.com/aunetx/blur-my-shell) by aunetx — `extensions/blur-my-shell@aunetx/LICENSE`
- [GreyStone icons](https://codeberg.org/StormRosenaa/GreyStone) by Seth Storm Rosenaa — `icons/GreyStone - circle/LICENSE`
- [Future cursors](https://github.com/yeyushengfan258/Future-cursors) by yeyushengfan258 — `icons/Future-black-cursors/LICENSE`
