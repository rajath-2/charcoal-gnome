"""Extension Manager and installer prerequisite tests; installs are simulated, never run on the host."""
import contextlib
import importlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ExtensionManagerTest(unittest.TestCase):
    def setUp(self):
        self.em = importlib.import_module('extension_manager')
        self.available = {'flatpak'}
        self.calls = []
        self.answers = []
        self.failed = False
        roots = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, roots)
        self.user_app = roots / 'user/flatpak/app' / self.em.MANAGER_ID
        self.system_app = roots / 'system/app' / self.em.MANAGER_ID
        self.output = io.StringIO()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(contextlib.redirect_stdout(self.output))
        stack.enter_context(contextlib.redirect_stderr(self.output))
        stack.enter_context(patch.object(self.em.shutil, 'which',
                                        side_effect=lambda x: '/usr/bin/' + x if x in self.available else None))
        stack.enter_context(patch.dict(os.environ, {'XDG_DATA_HOME': str(roots / 'user')}))
        stack.enter_context(patch.object(self.em, 'FLATPAK_SYSTEM_DIR', roots / 'system'))
        stack.enter_context(patch.object(self.em.sys.stdin, 'isatty', return_value=True))
        stack.enter_context(patch('builtins.input', side_effect=lambda _: self.answers.pop(0)))
        stack.enter_context(patch.object(self.em.subprocess, 'run', side_effect=self.execute))

    def execute(self, command, **kwargs):
        self.calls.append(command)
        if self.failed:
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(command, 0)

    def test_install_is_per_user_flatpak_without_sudo(self):
        self.answers = ['yes']
        self.em.install_manager(dry_run=False)
        self.assertEqual(self.calls, [['flatpak', 'install', '--user', '--from', self.em.MANAGER_REF]])

    def test_declining_installs_nothing(self):
        for answer in ['', 'n', 'no']:
            with self.subTest(answer=answer):
                self.answers = [answer]
                self.em.install_manager(dry_run=False)
        self.assertEqual(self.calls, [])

    def test_dry_run_prints_command_without_prompt_or_install(self):
        self.em.install_manager(dry_run=True)
        self.assertEqual(self.calls, [])
        self.assertIn('flatpak install --user', self.output.getvalue())

    def test_existing_native_user_or_system_install_is_not_reinstalled(self):
        for make in (lambda: self.available.add('extension-manager'),
                     lambda: self.user_app.mkdir(parents=True),
                     lambda: self.system_app.mkdir(parents=True)):
            make()
            self.em.install_manager(dry_run=False)
            self.available.discard('extension-manager')
            shutil.rmtree(self.user_app, ignore_errors=True)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.output.getvalue().count('already installed'), 3)

    def test_missing_flatpak_skips_with_guidance(self):
        self.available.remove('flatpak')
        self.em.install_manager(dry_run=False)
        self.assertEqual(self.calls, [])
        self.assertIn('package manager', self.output.getvalue())

    def test_failure_or_no_terminal_only_warns(self):
        self.failed = True
        self.answers = ['yes']
        self.em.install_manager(dry_run=False)
        with patch.object(self.em.sys.stdin, 'isatty', return_value=False):
            self.em.install_manager(dry_run=False)
        self.assertEqual(self.output.getvalue().count('Warning'), 2)


class InstallerIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.installer = importlib.import_module('install')
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        self.output = io.StringIO()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(contextlib.redirect_stdout(self.output))
        stack.enter_context(contextlib.redirect_stderr(self.output))
        stack.enter_context(patch.object(self.installer, 'STATE', self.home / 'backups'))
        stack.enter_context(patch.object(self.installer, 'TARGETS', {
            'extensions/charcoal-widgets@local': self.home / 'extensions/widgets',
            'extensions/blur-my-shell@aunetx': self.home / 'extensions/blur',
        }))
        stack.enter_context(patch.object(self.installer, 'DATA', self.home))
        stack.enter_context(patch.object(self.installer.os, 'geteuid', return_value=1000))

    def main(self, *args):
        with patch.object(sys, 'argv', ['install.py', '--only', 'widgets', *args]):
            return self.installer.main()

    def test_missing_dependency_fails_with_guidance_without_sudo_or_backup(self):
        with patch.object(self.installer.shutil, 'which', return_value=None), \
                patch.object(subprocess, 'run', side_effect=AssertionError('Ran a command')), \
                patch('builtins.input', side_effect=AssertionError('Prompted')):
            self.assertEqual(self.main('--no-activate'), 1)
        self.assertIn('glib-compile-schemas', self.output.getvalue())
        self.assertIn('package manager', self.output.getvalue())
        self.assertFalse(any(self.home.iterdir()))

    def test_wrong_gnome_fails_before_manager_setup(self):
        with patch.object(self.installer.shutil, 'which', return_value='/usr/bin/tool'), \
                patch.object(self.installer, 'run', return_value='GNOME Shell 49.1'), \
                patch.object(self.installer, 'install_manager', side_effect=AssertionError('Setup ran')):
            self.assertEqual(self.main('--install-extension-manager'), 1)
        self.assertIn('GNOME Shell 50 or 51', self.output.getvalue())
        self.assertFalse(any(self.home.iterdir()))

    def test_root_is_rejected(self):
        with patch.object(self.installer.os, 'geteuid', return_value=0):
            with self.assertRaises(SystemExit):
                self.main()
        self.assertIn('not sudo/root', self.output.getvalue())

    def test_optional_manager_failure_still_installs_and_backs_up_theme(self):
        deps = importlib.import_module('extension_manager')
        real_run = subprocess.run
        def execute(command, **kwargs):
            if command[0] == 'flatpak':
                raise subprocess.CalledProcessError(1, command)
            return real_run(command, **kwargs)
        actual_which = self.installer.shutil.which
        with patch.object(deps.shutil, 'which', side_effect=lambda c: '/bin/flatpak' if c == 'flatpak' else actual_which(c)), \
                patch.object(sys.stdin, 'isatty', return_value=True), \
                patch('builtins.input', return_value='yes'), \
                patch.object(deps.subprocess, 'run', side_effect=execute), \
                patch.object(deps, 'FLATPAK_SYSTEM_DIR', self.home / 'no-system-flatpak'):
            # Match the actual schema locations install() derives from DATA.
            self.installer.TARGETS.update({
                'extensions/charcoal-widgets@local': self.home / 'gnome-shell/extensions/charcoal-widgets@local',
                'extensions/blur-my-shell@aunetx': self.home / 'gnome-shell/extensions/blur-my-shell@aunetx',
            })
            self.assertEqual(self.main('--no-activate', '--install-extension-manager'), 0)
        self.assertTrue((self.home / 'gnome-shell/extensions/charcoal-widgets@local/schemas/gschemas.compiled').is_file())
        self.assertTrue(any((self.home / 'backups').iterdir()))
        self.assertIn('Warning', self.output.getvalue())


class InstallerFlagsTest(unittest.TestCase):
    def run_installer(self, *args):
        return subprocess.run([str(ROOT / 'install.sh'), *args], text=True, capture_output=True)

    def test_help_has_only_the_no_sudo_setup_flag(self):
        result = self.run_installer('--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('--install-extension-manager', result.stdout)
        self.assertNotIn('--install-deps', result.stdout)
        self.assertNotIn('--interactive', result.stdout)

    def test_restore_rejects_manager_flag_before_reading_backup(self):
        result = self.run_installer('--restore', '/does-not-exist', '--install-extension-manager')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot be combined with --restore', result.stderr)

    def test_missing_python_has_actionable_wrapper_error(self):
        with tempfile.TemporaryDirectory() as directory:
            bindir = Path(directory)
            # Invoke bash directly so /usr/bin/env does not need a PATH lookup.
            (bindir / 'dirname').symlink_to('/usr/bin/dirname')
            result = subprocess.run(['/bin/bash', str(ROOT / 'install.sh')],
                                    env=dict(os.environ, PATH=directory), text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Python 3.9', result.stderr)
            self.assertIn('README', result.stderr)

    def test_dry_run_does_not_write_python_cache_in_source_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'bundle'
            root.mkdir()
            home = Path(directory) / 'home'
            home.mkdir()
            for name in ('install.py', 'extension_manager.py'):
                shutil.copyfile(ROOT / name, root / name)
            for name in ('gtk-4.0', 'icons', 'extensions'):
                (root / name).symlink_to(ROOT / name, target_is_directory=True)
            env = dict(os.environ, HOME=str(home), XDG_DATA_HOME=str(home / 'data'),
                       XDG_CONFIG_HOME=str(home / 'config'), XDG_STATE_HOME=str(home / 'state'))
            env.pop('PYTHONDONTWRITEBYTECODE', None)
            result = subprocess.run([sys.executable, str(root / 'install.py'), '--no-activate', '--dry-run'],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / '__pycache__').exists())
            self.assertFalse(any(home.iterdir()))


if __name__ == '__main__':
    unittest.main()
