"""File-install tests run in an isolated HOME and never change desktop settings."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InstallerTest(unittest.TestCase):
    def test_install_repeat_restore_and_dry_run(self):
        with tempfile.TemporaryDirectory(prefix='gnome-theme-install-test-') as directory:
            home = Path(directory)
            env = dict(os.environ, HOME=str(home), XDG_DATA_HOME=str(home / '.local/share'),
                       XDG_CONFIG_HOME=str(home / '.config'), XDG_STATE_HOME=str(home / '.local/state'))
            gtk = home / '.config/gtk-4.0'
            gtk.mkdir(parents=True)
            (gtk / 'original.txt').write_text('preserve me')
            # Exercise backing up/restoring a symlink without traversing its target.
            original_theme = home / 'original-theme'
            original_theme.mkdir()
            (original_theme / 'sentinel').write_text('untouched')
            theme = home / '.themes/Waybar-GNOME'
            theme.parent.mkdir()
            theme.symlink_to(original_theme, target_is_directory=True)
            # A previous bundle's extension is retired into the backup, then restored.
            legacy = home / '.local/share/gnome-shell/extensions/adaptive-smoke-panel@local'
            legacy.mkdir(parents=True)
            (legacy / 'extension.js').write_text('old')

            def run(*args):
                result = subprocess.run([str(ROOT / 'install.sh'), *args], env=env,
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout

            run('--dry-run', '--no-activate')
            self.assertFalse((home / '.local/state').exists())
            run('--no-activate')
            self.assertEqual((gtk / 'gtk.css').read_bytes(), (ROOT / 'gtk-4.0/gtk.css').read_bytes())
            self.assertFalse((gtk / 'gtk.css.backup').exists())
            self.assertFalse(theme.is_symlink())
            self.assertEqual((original_theme / 'sentinel').read_text(), 'untouched')
            self.assertFalse(legacy.exists())
            extension = home / '.local/share/gnome-shell/extensions/charcoal-topbar@local'
            self.assertEqual((extension / 'extension.js').read_bytes(),
                             (ROOT / 'extensions/charcoal-topbar@local/extension.js').read_bytes())
            for name in ['charcoal-topbar@local', 'charcoal-appearance@local']:
                self.assertTrue((home / '.local/share/gnome-shell/extensions' / name / 'schemas/gschemas.compiled').is_file())
            launcher = home / '.local/share/gnome-shell/extensions/charcoal-launchers@local'
            self.assertTrue((launcher / 'prefs.js').is_file())
            self.assertTrue((launcher / 'schemas/gschemas.compiled').is_file())
            backup_root = home / '.local/state/gnome-themes/backups'
            first = next(backup_root.iterdir())
            self.assertEqual(json.loads((first / 'manifest.json').read_text())['status'], 'complete')
            run('--no-activate')
            second = next(p for p in backup_root.iterdir() if p != first)
            run('--restore', str(second), '--dry-run')
            self.assertTrue((gtk / 'gtk.css').exists())
            run('--restore', str(second))
            self.assertTrue((gtk / 'gtk.css').exists())
            run('--restore', str(first))
            self.assertEqual((gtk / 'original.txt').read_text(), 'preserve me')
            self.assertFalse((gtk / 'gtk.css').exists())
            self.assertTrue(theme.is_symlink())
            self.assertEqual(theme.resolve(), original_theme)
            self.assertFalse(extension.exists())
            self.assertEqual((legacy / 'extension.js').read_text(), 'old')
            self.assertFalse(launcher.exists())

    def test_only_installs_the_chosen_pieces(self):
        with tempfile.TemporaryDirectory(prefix='gnome-theme-install-test-') as directory:
            home = Path(directory)
            env = dict(os.environ, HOME=str(home), XDG_DATA_HOME=str(home / '.local/share'),
                       XDG_CONFIG_HOME=str(home / '.config'), XDG_STATE_HOME=str(home / '.local/state'))
            extensions = home / '.local/share/gnome-shell/extensions'
            legacy = extensions / 'adaptive-smoke-panel@local'
            legacy.mkdir(parents=True)
            result = subprocess.run([str(ROOT / 'install.sh'), '--no-activate', '--only', 'appearance'],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue((home / '.config/gtk-4.0/gtk.css').is_file())
            self.assertTrue((home / '.local/share/icons/GreyStone - circle/index.theme').is_file())
            self.assertTrue((extensions / 'charcoal-appearance@local/schemas/gschemas.compiled').is_file())
            for absent in ['charcoal-topbar@local', 'charcoal-launchers@local', 'blur-my-shell@aunetx']:
                self.assertFalse((extensions / absent).exists(), absent)
            self.assertTrue(legacy.exists(), 'the old top bar is only retired with --only topbar')


if __name__ == '__main__':
    unittest.main()
