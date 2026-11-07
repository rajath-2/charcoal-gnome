"""Optional per-user Extension Manager setup from Flathub; never uses sudo."""
from pathlib import Path
import os
import shlex
import shutil
import subprocess
import sys

MANAGER_ID = 'com.mattjakeman.ExtensionManager'
FLATPAK_SYSTEM_DIR = Path('/var/lib/flatpak')
MANAGER_REF = f'https://dl.flathub.org/repo/appstream/{MANAGER_ID}.flatpakref'


def confirm(question):
    if not sys.stdin.isatty():
        raise RuntimeError('installation consent requires an interactive terminal')
    try:
        return input(f'{question} [y/N] ').strip().lower() in ('y', 'yes')
    except EOFError:
        return False


def manager_installed():
    if shutil.which('extension-manager'):
        return True
    # Folder checks, not `flatpak info`: that creates repo/cache dirs, and dry runs must not write.
    # shortcut: ignores custom installations in /etc/flatpak/installations.d; query flatpak if users report reinstalls.
    user = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share') / 'flatpak'
    return any((root / 'app' / MANAGER_ID).is_dir() for root in (user, FLATPAK_SYSTEM_DIR))


def install_manager(dry_run):
    """Offer the GUI; any failure only warns so the theme install continues."""
    try:
        if manager_installed():
            print('Extension Manager is already installed.')
            return
        if not shutil.which('flatpak'):
            print('Warning: Extension Manager skipped: install Flatpak with your package manager, then rerun.')
            return
        command = ['flatpak', 'install', '--user', '--from', MANAGER_REF]
        print('Optional Extension Manager command:', shlex.join(command))
        if dry_run:
            return
        if not confirm('Install Extension Manager for this user from Flathub? Flatpak may add its remote and runtime.'):
            print('Extension Manager skipped.')
            return
        subprocess.run(command, check=True)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Warning: optional Extension Manager setup failed: {error}. Continuing with the theme bundle.',
              file=sys.stderr)
