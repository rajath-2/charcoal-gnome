# Charcoal GNOME theme bundle

Personal GNOME **51** setup, packaged as four extensions plus GTK4 styling:

| Extension | What it does | Preferences |
| --- | --- | --- |
| `charcoal-topbar@local` | Top bar and popup styling; auto / compact / islands layout | Layout, static or live blur |
| `charcoal-appearance@local` | GreyStone icons, Future Black cursor, dark style, left window buttons | Icons, cursor, size, style, buttons |
| `charcoal-launchers@local` | Super+Space search and hold-Super favorites wheel | See below |
| `charcoal-widgets@local` | Weather, calendar and music on the empty desktop | See below |

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

Clone this repository, then run inside your GNOME session as your normal user:

```bash
git clone https://github.com/rajath-2/charcoal-gnome.git
cd charcoal-gnome
./install.sh --dry-run    # preview, changes nothing
./install.sh
```

Install only some pieces with `--only` (any combination):

```bash
./install.sh --only topbar        # Charcoal Topbar + Blur My Shell
./install.sh --only appearance    # Charcoal Appearance + GTK styling, icons, cursor
./install.sh --only launchers     # Charcoal Launchers + Blur My Shell (for its blur)
./install.sh --only widgets       # Charcoal Widgets + Blur My Shell (for its blur)
./install.sh --only topbar launchers
```

Pieces you leave out are not touched. Only `topbar` changes desktop settings (blur
profiles, the starting layout) and retires an older top-bar setup.

The default is **automatic** mode: a complete bar when no visible app on the
current workspace/panel monitor is fully maximized; islands when one is maximized.
The controls stay anchored while the background splits/joins. **Invert automatic layout** in
Preferences swaps the two: islands on the desktop, a full bar while an app is maximized. Popup handoffs and
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

Each invocation installs the chosen pieces (all by default) and creates a new backup. The
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

- `charcoal-topbar@local`, `charcoal-appearance@local`, `charcoal-launchers@local`,
  `charcoal-widgets@local` (above).
- `blur-my-shell@aunetx`: the exact installed version used with this setup, including
  its popup blur support. Its license and metadata are included.

The top bar no longer needs a Shell theme or the User Themes extension. Installing
moves an older bundle's `adaptive-smoke-panel@local` and `~/.themes/Waybar-GNOME*`
into the backup, and clears a User Themes selection that pointed at them.

Activation enables the five extensions, sets the starting layout, and configures
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
- **Hold Super:** compact favorites wheel at the cursor. Move toward an app and release
  to launch: the direction picks it, so overshooting past the wheel still selects the
  outermost app that way. Release in the center (or press Esc) to cancel.
- **Your own trigger keys:** Preferences → Wheel → Trigger adds, changes or removes keys
  that open the wheel while held. You can turn off Hold Super there too. For a mouse side
  button, map it to a key such as F13 in the mouse's software, Piper or Input Remapper,
  then add that key: GNOME doesn't let extensions see clicks made on app windows.
- **Esc:** cancel. Other Super shortcuts cancel the wheel and retain their action.
- **Window previews:** rest on a running app for a moment to see its windows beside the wheel.
  Move out to them (the app stays selected along its direction) and release on one to bring
  that exact window up. In dock mode, releasing on the focused window minimizes it.
- **Three-finger touchpad:** rest three fingers (same hold delay) to open the wheel at the
  pointer, slide toward an app, and lift to open it. Lifting without sliding cancels. Quick
  three-finger swipes still switch workspaces and open the overview.
- **Radial dock mode** (Preferences): running apps join the wheel as outer rings. Windows
  open out of the cursor, and releasing on the focused app minimizes it into the cursor;
  releasing on it again restores it from there. Every minimize and restore in this mode
  (Super+H, the title-bar button) also goes into and out of the cursor. With the dock hidden,
  Super+1…9 open the 1st…9th wheel favorite (clockwise from the top) the same way.

Open **Extensions → Charcoal Launchers → Preferences**, or run:

```bash
gnome-extensions prefs charcoal-launchers@local
```

Preferences include favorite apps and order, wheel size/spacing, separate wheel and search colors, opacity,
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
node --test tests/test_launchers.mjs tests/test_topbar.mjs tests/test_widgets.mjs
gjs -m tests/test_icon_update.js    # ICON_UPDATE_NETWORK=1 XDG_DATA_HOME=/tmp/x also downloads
glib-compile-schemas --strict extensions/charcoal-launchers@local/schemas
```

The new UI and gestures were exercised in an isolated GNOME 51.1 Wayland session,
including a focused application, Super+Left, selected/neutral release, Escape,
shortcut conflict rejection, provider responses, Preferences, and blur. Physical
keyboard behavior and mixed-DPI monitors still merit checking after login.

## Look options

The top bar, its menus, the search panel, the wheel and the widgets each have their own
background, outline (color, width, strength) and shadow (color, size, strength; a bright
color reads as a glow) in their Appearance preferences. The bar and the search panel also
have a text size. The wheel's shadow applies to its window previews.

## Desktop widgets

Charcoal Widgets puts three cards on the desktop: **weather** (top-left), a **month
calendar** (top-right) and a **music player** (bottom-center). They sit above the
wallpaper and below every window, and show only while no window is open on that
screen; minimizing everything brings them back.

- Drag a card by its background to move it; positions are remembered per monitor.
  **Lock widgets** and **Reset positions** are in Preferences.
- Weather comes from [Open-Meteo](https://open-meteo.com) (no account). Search for your
  city in Preferences; the search also uses OpenStreetMap, so names like "Bangalore"
  find Bengaluru. Updates every 30 minutes, °C. Nothing is fetched while the weather
  card is off.
- The calendar shows the events from your top bar's date menu (GNOME Online Accounts)
  as a dot under the date; click a date to list its events.
- The music card follows the app that is playing (Spotify, browsers, any MPRIS
  player). Shuffle, repeat and seeking dim when the player does not support them.
  With nothing playing it shows "Nothing playing" and artwork you can choose.
- Drag any edge or corner of a widget to give it any width and height, e.g. the
  calendar in the weather card's shape. Content rearranges as you drag, according to both width
  and height. **Reset shapes** in Preferences makes each fit its default content again.
- A compact calendar shows the date and next remaining event for that day. More room reveals
  a selectable week, then the full month and more events; a wide month card puts its agenda
  beside the grid. The date rolls over at midnight while the desktop stays visible.
- Weather rearranges into a row in wide cards and reveals city, high/low, feels-like, humidity,
  and wind when they fit. Music keeps title and play/pause accessible, adding artwork, artist,
  transport controls, seeking, shuffle/repeat, and album as space allows.
- Each widget has its own **Text and icon size** (70–150%). This controls readability;
  the actual card dimensions determine which details fit. Very tiny shapes use a final fit
  adjustment after reducing content to the essentials.
- Every color, border, glow, corner radius and the blur are in **Appearance**;
  **Restore reference look** returns the amber glass default.

## License

GPL-3.0-or-later; see [LICENSE](LICENSE). Bundled third-party work keeps its own
license and credits, all GPL-3.0:

- [Blur My Shell](https://github.com/aunetx/blur-my-shell) by aunetx — `extensions/blur-my-shell@aunetx/LICENSE`
- [GreyStone icons](https://codeberg.org/StormRosenaa/GreyStone) by Seth Storm Rosenaa — `icons/GreyStone - circle/LICENSE`
- [Future cursors](https://github.com/yeyushengfan258/Future-cursors) by yeyushengfan258 — `icons/Future-black-cursors/LICENSE`
