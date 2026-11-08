#!/usr/bin/env python3
"""Install the GNOME 51 theme bundle for the current user; offline by default."""
import argparse
import ast
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True  # keep the bundle checkout untouched, even on --dry-run
from extension_manager import install_manager

ROOT = Path(__file__).resolve().parent
HOME_DIR = Path.home()
DATA = Path(os.environ.get('XDG_DATA_HOME', HOME_DIR / '.local/share'))
CONFIG = Path(os.environ.get('XDG_CONFIG_HOME', HOME_DIR / '.config'))
STATE = Path(os.environ.get('XDG_STATE_HOME', HOME_DIR / '.local/state')) / 'gnome-themes/backups'
BLUR = 'blur-my-shell@aunetx'
TOPBAR = 'charcoal-topbar@local'
APPEARANCE = 'charcoal-appearance@local'
LAUNCHERS = 'charcoal-launchers@local'
WIDGETS = 'charcoal-widgets@local'
THEMES = 'charcoal-themes@local'
CONTROLS = 'charcoal-controls@local'
EXTENSIONS = [BLUR, TOPBAR, APPEARANCE, LAUNCHERS, WIDGETS, THEMES, CONTROLS]
# Earlier bundles: the top bar was a Shell theme plus this extension, loaded by user-theme.
AUTO = 'adaptive-smoke-panel@local'
USER_THEME = 'user-theme@gnome-shell-extensions.gcampax.github.com'
OLD_THEMES = ['Waybar-GNOME', 'Waybar-GNOME-Islands']
TARGETS = {'gtk-4.0': CONFIG / 'gtk-4.0'}
for name in ['GreyStone - circle', 'Future-black-cursors']:
    TARGETS[f'icons/{name}'] = DATA / 'icons' / name
for name in EXTENSIONS:
    TARGETS[f'extensions/{name}'] = DATA / 'gnome-shell/extensions' / name
# Moved into the backup on install (not replaced), so restore can bring them back.
LEGACY = {f'themes/{name}': HOME_DIR / '.themes' / name for name in OLD_THEMES}
LEGACY[f'extensions/{AUTO}'] = DATA / 'gnome-shell/extensions' / AUTO
# Installable pieces. Blur My Shell provides the blur for the top bar, the launchers and the widgets.
COMPONENTS = {
    'topbar': [f'extensions/{BLUR}', f'extensions/{TOPBAR}'],
    'appearance': ['gtk-4.0', 'icons/GreyStone - circle', 'icons/Future-black-cursors', f'extensions/{APPEARANCE}'],
    'launchers': [f'extensions/{BLUR}', f'extensions/{LAUNCHERS}'],
    'widgets': [f'extensions/{BLUR}', f'extensions/{WIDGETS}'],
    'themes': [f'extensions/{THEMES}'],
    'controls': [f'extensions/{CONTROLS}'],
}
SCHEMA_DIRS = {'org.gnome.shell.extensions.blur-my-shell': BLUR, 'org.gnome.shell.extensions.user-theme': USER_THEME,
               'org.gnome.shell.extensions.charcoal-topbar': TOPBAR}


def run(args):
    return subprocess.run([str(a) for a in args], check=True, text=True, capture_output=True).stdout.strip()


def gs(action, schema, key, value=None):
    args = ['gsettings']
    for prefix, extension in SCHEMA_DIRS.items():
        if schema.startswith(prefix):
            args += ['--schemadir', DATA / 'gnome-shell/extensions' / extension / 'schemas']
    args += [action, schema, key]
    if value is not None:
        args.append(value)
    return run(args)


def setting_plan(mode):
    # Icons/cursor/style: charcoal-appearance. Panel blur on/off and static/dynamic: charcoal-topbar.
    bms = 'org.gnome.shell.extensions.blur-my-shell'
    panel, popup = f'{bms}.panel', f'{bms}.popup'
    plan = [
        ('org.gnome.shell.extensions.charcoal-topbar', 'mode', repr(mode)),
        (panel, 'override-background', 'false'),
        (panel, 'override-background-dynamically', 'false'), (panel, 'gradient-panel', 'false'),
        (panel, 'corner-radius', '10'), (panel, 'rounded-corners', '0'),
        (popup, 'blur', 'true'), (popup, 'override-background', 'false'),
        (popup, 'pipeline', repr('pipeline_charcoal_popup_light')),
        # Live (dynamic) blur re-renders what is behind every frame; keep it opt-in.
        (f'{bms}.dash-to-dock', 'static-blur', 'true'),
        (f'{bms}.applications', 'static-blur', 'true'),
    ]
    theme = 'org.gnome.shell.extensions.user-theme'
    if (DATA / 'gnome-shell/extensions' / USER_THEME / 'schemas').is_dir() and \
            gs('get', theme, 'name').strip("'") in OLD_THEMES:
        plan.append((theme, 'name', "''"))  # Charcoal Topbar now carries this styling.
    for key, value in [('menu-corner-radius', 22), ('quick-settings-corner-radius', 22),
                       ('calendar-corner-radius', 22), ('notification-corner-radius', 16),
                       ('submenu-corner-radius', 16)]:
        plan.append((popup, key, str(value)))
    return plan


def exists(path):
    return path.exists() or path.is_symlink()


def remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def write_manifest(folder, data):
    (folder / 'manifest.json').write_text(json.dumps(data, indent=2) + '\n')


def preflight(activate):
    for label, target in TARGETS.items():
        source = ROOT / label
        if not source.is_dir():
            raise RuntimeError(f'Missing bundle directory: {source}')
        if source.resolve().is_relative_to(target.resolve()) or target.resolve().is_relative_to(source.resolve()):
            raise RuntimeError(f'Source and destination overlap: {source} / {target}')
    commands = ['glib-compile-schemas'] + (['gsettings', 'gjs'] if activate else [])
    missing = [c for c in commands if not shutil.which(c)]
    if missing:
        raise RuntimeError(f'Required commands missing: {", ".join(missing)}. Install them with your '
                           "distribution's package manager (see README.md, Dependencies), then rerun.")
    if activate:
        if not shutil.which('gnome-shell'):
            raise RuntimeError('Activation requires an existing GNOME Shell 51 desktop. '
                               'See README.md for setup, or use --no-activate to copy only.')
        version = run(['gnome-shell', '--version'])
        if not re.search(r'GNOME Shell 51(?:\.|\s|$)', version):
            raise RuntimeError(f'Activation requires GNOME Shell 51; found {version}. Use --no-activate to copy only.')
        if not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
            raise RuntimeError('Run inside your GNOME session, or use --no-activate.')
        if os.environ.get('GSETTINGS_BACKEND') == 'memory':
            raise RuntimeError('The memory settings backend cannot persist an installation; use --no-activate.')


def install(args):
    preflight(not args.no_activate)
    if args.install_extension_manager:
        install_manager(args.dry_run)
    labels = {label for name in args.only for label in COMPONENTS[name]}
    targets = {label: target for label, target in TARGETS.items() if label in labels}
    extensions = [x for x in EXTENSIONS if f'extensions/{x}' in labels]
    topbar = 'topbar' in args.only
    # The old top bar (theme + adaptive panel) is only replaced when the new top bar is installed.
    legacy = LEGACY if topbar else {}
    print('Installing:', ', '.join(args.only), '(copy only)' if args.no_activate else f'(activate, top bar mode {args.mode})' if topbar else '(activate)')
    for label, target in targets.items():
        print(f'  {label} -> {target}')
    for target in legacy.values():
        if exists(target):
            print(f'  retire {target} (moved into the backup)')
    if args.dry_run:
        print('Dry run: no files or settings changed.')
        return
    STATE.mkdir(parents=True, exist_ok=True)
    backup = STATE / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    (backup / 'files').mkdir(parents=True)
    manifest = {'format': 1, 'home': str(HOME_DIR), 'targets': {}, 'settings': [], 'status': 'installing'}
    write_manifest(backup, manifest)
    try:
        if not args.no_activate:
            for key in ['enabled-extensions', 'disabled-extensions']:
                manifest['settings'].append(['org.gnome.shell', key, gs('get', 'org.gnome.shell', key)])
            write_manifest(backup, manifest)
            if LAUNCHERS in extensions:
                stop_launchers()
        for label, target in targets.items():
            manifest['targets'][label] = {'path': str(target), 'existed': exists(target), 'installed': False}
            write_manifest(backup, manifest)
            if exists(target):
                saved = backup / 'files' / label
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(saved))
            target.parent.mkdir(parents=True, exist_ok=True)
            # Do not install old GTK edit snapshots as live configuration.
            ignore = shutil.ignore_patterns('gtk.css.*') if label == 'gtk-4.0' else None
            shutil.copytree(ROOT / label, target, symlinks=True, ignore=ignore)
            if label in {f'extensions/{name}' for name in [TOPBAR, APPEARANCE, LAUNCHERS, WIDGETS, CONTROLS]}:
                for module in ['theme-client.js', 'theme-policy.js', 'theme-catalog.js', 'theme-profile.js',
                               'theme-editor.js', 'theme-controls.js']:
                    shutil.copy2(ROOT / 'shared' / module, target / module)
            manifest['targets'][label]['installed'] = True
            write_manifest(backup, manifest)
        for label, target in legacy.items():
            if exists(target):
                manifest['targets'][label] = {'path': str(target), 'existed': True, 'installed': False}
                saved = backup / 'files' / label
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(saved))
                write_manifest(backup, manifest)
        for extension in extensions:
            run(['glib-compile-schemas', DATA / 'gnome-shell/extensions' / extension / 'schemas'])
        if not args.no_activate:
            # Only the top bar changes desktop settings; the other pieces just get enabled.
            plan = setting_plan(args.mode) if topbar else []
            special = [('org.gnome.shell', 'enabled-extensions'), ('org.gnome.shell', 'disabled-extensions')]
            if topbar:
                special.append(('org.gnome.shell.extensions.blur-my-shell', 'pipelines'))
            for schema, key in [(s, k) for s, k, _ in plan] + special:
                if any(s == schema and k == key for s, k, _ in manifest['settings']):
                    continue
                value = gs('get', schema, key)
                if gs('writable', schema, key) != 'true':
                    raise RuntimeError(f'Setting is locked: {schema} {key}')
                manifest['settings'].append([schema, key, value])
            write_manifest(backup, manifest)
            if topbar:
                # Let running top-bar instances restore their blur state before applying settings.
                current_disabled = ast.literal_eval(gs('get', 'org.gnome.shell', 'disabled-extensions').removeprefix('@as '))
                missing = [x for x in [AUTO, TOPBAR] if x not in current_disabled]
                if missing:
                    gs('set', 'org.gnome.shell', 'disabled-extensions', repr(current_disabled + missing))
                    time.sleep(0.5)
                run(['gjs', '-m', ROOT / 'configure-blur.js', DATA / 'gnome-shell/extensions' / BLUR / 'schemas'])
            for schema, key, value in plan:
                gs('set', schema, key, value)
                if gs('get', schema, key) != value:
                    raise RuntimeError(f'Setting did not persist: {schema} {key}')
            enabled = ast.literal_eval(gs('get', 'org.gnome.shell', 'enabled-extensions').removeprefix('@as '))
            disabled = ast.literal_eval(gs('get', 'org.gnome.shell', 'disabled-extensions').removeprefix('@as '))
            wanted = extensions
            retired = [AUTO] if topbar else []
            enabled = [x for x in enabled if x not in wanted + retired] + wanted
            disabled = [x for x in disabled if x not in wanted + retired]
            gs('set', 'org.gnome.shell', 'disabled-extensions', repr(disabled))
            gs('set', 'org.gnome.shell', 'enabled-extensions', repr(enabled))
        manifest['status'] = 'complete'
        write_manifest(backup, manifest)
    except Exception:
        manifest['status'] = 'failed'
        write_manifest(backup, manifest)
        print(f'Installation interrupted. Restore with: ./install.sh --restore "{backup}"', file=sys.stderr)
        raise
    print(f'Installed. Backup: {backup}')
    if not args.no_activate:
        print('Log out and back in to load the installed extension code. No automatic logout is performed.')
        if gs('get', 'org.gnome.shell', 'disable-user-extensions') == 'true':
            print('User extensions are globally disabled. Enable them in the Extensions application.')


def stop_launchers():
    if not os.environ.get('DBUS_SESSION_BUS_ADDRESS') or not shutil.which('gnome-extensions'):
        return
    env = dict(os.environ, LC_ALL='C')
    def info():
        return subprocess.run(['gnome-extensions', 'info', LAUNCHERS], env=env,
                              capture_output=True, text=True, check=False).stdout
    details = info()
    installed_path = DATA / 'gnome-shell/extensions' / LAUNCHERS
    if not any(line.strip() == f'Path: {installed_path}' for line in details.splitlines()):
        return  # An isolated file-install test must not disable the live extension.
    run(['gnome-extensions', 'disable', LAUNCHERS])
    for _ in range(20):
        details = info()
        if not re.search(r'State: (ACTIVE|ENABLED)\b', details):
            return
        time.sleep(0.1)
    raise RuntimeError('Launcher is still active; refusing to replace its files before cleanup.')


def restore(args):
    backup = Path(args.restore).expanduser().resolve()
    data = json.loads((backup / 'manifest.json').read_text())
    if data.get('format') != 1 or data.get('home') != str(HOME_DIR) or data.get('status') == 'restored':
        raise RuntimeError('Not an unrestored backup for this user.')
    known = {**TARGETS, **LEGACY}
    for label, entry in data['targets'].items():
        if label not in known or Path(entry['path']) != known[label]:
            raise RuntimeError('Backup destinations do not match current HOME/XDG directories.')
    if args.dry_run:
        print(f'Would restore files and {len(data["settings"])} settings from {backup}')
        return
    if f'extensions/{LAUNCHERS}' in data['targets']:
        stop_launchers()
    # Restore settings while the bundled extension schemas still exist.
    for schema, key, value in reversed(data['settings']):
        gs('set', schema, key, value)
    for label, entry in reversed(list(data['targets'].items())):
        target = known[label]
        saved = backup / 'files' / label
        if exists(saved):
            remove(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(saved), str(target))
        elif not entry['existed']:
            remove(target)
    data['status'] = 'restored'
    write_manifest(backup, data)
    print('Restored previous files and settings. Log out/in if extensions were active.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['auto', 'compact', 'islands'], default='auto',
                        help='initial top bar layout; change later in Charcoal Topbar preferences')
    parser.add_argument('--only', nargs='+', choices=list(COMPONENTS), default=list(COMPONENTS), metavar='PIECE',
                        help='install only some pieces: topbar, appearance, launchers, widgets, themes (default: all)')
    parser.add_argument('--dry-run', action='store_true', help='show changes without writing')
    parser.add_argument('--no-activate', action='store_true', help='install files without desktop settings changes')
    parser.add_argument('--install-extension-manager', action='store_true',
                        help='offer to install optional Extension Manager from Flathub for this user')
    parser.add_argument('--restore', metavar='BACKUP_DIR', help='restore a backup created by this installer')
    args = parser.parse_args()
    if args.restore and args.install_extension_manager:
        parser.error('--install-extension-manager cannot be combined with --restore.')
    if os.geteuid() == 0:
        parser.error('Run as your normal desktop user, not sudo/root.')
    try:
        restore(args) if args.restore else install(args)
    except KeyboardInterrupt:
        print('\nCancelled.', file=sys.stderr)
        return 130
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        detail = getattr(error, 'stderr', '') or str(error)
        print(f'Error: {detail.strip()}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
