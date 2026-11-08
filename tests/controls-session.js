import Gio from 'gi://Gio';
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
        controls._wheel.open(monitor.x + 300, monitor.y + 300);
        check(controls._wheel.actor, 'action wheel did not open');
        controls._select('themes');
        check(controls._wheel.layer === 'themes' && controls._wheel.themes.some(item => item[0] === 'night'),
            'theme layer did not open');
        controls._select('night');
        await pause(250);
        check(themes._settings.get_string('active-theme-id') === 'night', 'theme choice did not activate');
        check(!controls._wheel.actor, 'wheel stayed open after choosing theme');
        controls.disable();
        check(!controls._accelerators.length, 'shortcut was not released');
        console.log('CONTROLS PASS'); global.context.terminate();
    }
}
