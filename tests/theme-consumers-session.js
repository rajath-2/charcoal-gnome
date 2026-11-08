import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const check = (ok, message) => { if (!ok) throw new Error(message); };

export default class ThemeConsumersTest extends Extension {
    enable() {
        this.run().catch(error => { console.error('THEME CONSUMERS FAIL', error.message, error.stack); global.context.terminate(); });
    }

    async run() {
        await pause(1600);
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        shell.set_strv('enabled-extensions', ['charcoal-themes@local', 'charcoal-launchers@local',
            'charcoal-appearance@local', 'theme-consumers-test@local']);
        const launchers = Main.extensionManager.lookup('charcoal-launchers@local')?.stateObj;
        const appearance = Main.extensionManager.lookup('charcoal-appearance@local')?.stateObj;
        const themes = Main.extensionManager.lookup('charcoal-themes@local')?.stateObj;
        check(launchers?._settings && appearance?._settings && themes?._settings, 'extensions did not enable');
        launchers._settings.set_boolean('follow-theme', true);
        appearance._settings.set_boolean('follow-theme', true);
        themes._settings.set_string('requested-theme-id', 'night');
        await pause(400);
        check(launchers._wheel.settings.get_int('wheel-radius') === 180, 'wheel radius ignored theme');
        check(launchers._search.settings.get_int('launcher-width') === 800, 'search width ignored theme');
        check(launchers._settings.get_strv('favorites').length === launchers._wheel.settings.get_strv('favorites').length,
            'favorites changed');
        check(appearance._desktop.get('icon-theme').get_string('icon-theme') === 'Adwaita', 'icon choice ignored theme');
        launchers._settings.set_boolean('follow-theme', false);
        appearance._settings.set_boolean('follow-theme', false);
        await pause(200);
        check(launchers._wheel.settings.get_int('wheel-radius') === 120, 'unlinked wheel did not restore local');
        check(appearance._desktop.get('icon-theme').get_string('icon-theme') === appearance._settings.get_string('icon-theme'),
            'unlinked icon choice did not restore local');
        console.log('THEME CONSUMERS PASS');
        global.context.terminate();
    }
}
