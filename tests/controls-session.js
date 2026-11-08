import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const check = (ok, message) => { if (!ok) throw new Error(message); };

export default class ControlsTest extends Extension {
    enable() { this.run().catch(error => { console.error('CONTROLS FAIL', error.message, error.stack); global.context.terminate(); }); }
    async run() {
        await pause(1500);
        new Gio.Settings({schema_id: 'org.gnome.shell'}).set_strv('enabled-extensions',
            ['charcoal-themes@local', 'charcoal-controls@local', 'controls-test@local']);
        const controls = Main.extensionManager.lookup('charcoal-controls@local')?.stateObj;
        const themes = Main.extensionManager.lookup('charcoal-themes@local')?.stateObj;
        check(controls?._wheel && themes?._settings, 'extensions did not enable');
        check(controls._accelerators.length === 1, 'shortcut did not claim');
        const monitor = Main.layoutManager.primaryMonitor;
        const baseModal = Main.modalCount;
        controls._wheel.open(monitor.x + 300, monitor.y + 300);
        check(controls._wheel.actor, 'action wheel did not open');
        check(Main.modalCount === baseModal + 1 && Main.actionMode === Shell.ActionMode.POPUP,
            `wheel holds no modal grab (modalCount ${Main.modalCount}, actionMode ${Main.actionMode})`);
        // A real key press through a virtual keyboard must reach the grabbed wheel and close it.
        const keyboard = global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const now = () => GLib.get_monotonic_time();
        keyboard.notify_keyval(now(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(now(), Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
        await pause(250);
        check(!controls._wheel.actor, 'Escape did not close the wheel');
        check(Main.modalCount === baseModal && Main.actionMode === Shell.ActionMode.NORMAL,
            `modal grab not released after Escape (modalCount ${Main.modalCount})`);
        controls._wheel.open(monitor.x + 300, monitor.y + 300);
        controls._select('themes');
        check(controls._wheel.layer === 'themes' && controls._wheel.themes.some(item => item[0] === 'night'),
            'theme layer did not open');
        controls._select('night');
        await pause(250);
        check(themes._settings.get_string('active-theme-id') === 'night', 'theme choice did not activate');
        check(!controls._wheel.actor, 'wheel stayed open after choosing theme');
        check(Main.modalCount === baseModal, 'modal grab leaked after choosing theme');
        controls._wheel.open(monitor.x + 300, monitor.y + 300);
        // Power actions go through _call; it must return at once and report failures (no real service is hit).
        controls._settings.set_string('status', '');
        const started = GLib.get_monotonic_time();
        controls._call(Gio.DBus.session, 'org.charcoal.Missing', '/org/charcoal/Missing', 'org.charcoal.Missing', 'Nope');
        check(GLib.get_monotonic_time() - started < 50000, 'D-Bus call blocked the compositor');
        await pause(500);
        check(controls._settings.get_string('status').length > 0, 'failed D-Bus call was not reported');
        controls.disable();
        check(!controls._accelerators.length, 'shortcut was not released');
        check(Main.modalCount === baseModal, 'disable left the wheel modal grab held');
        console.log('CONTROLS PASS'); global.context.terminate();
    }
}
