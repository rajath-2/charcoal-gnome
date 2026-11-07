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
            extension = home / '.local/share/gnome-shell/extensions/adaptive-smoke-panel@local'
            self.assertEqual((extension / 'extension.js').read_bytes(),
                             (ROOT / 'extensions/adaptive-smoke-panel@local/extension.js').read_bytes())
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
            self.assertFalse(launcher.exists())


if __name__ == '__main__':
    unittest.main()
