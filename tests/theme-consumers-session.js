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
            'charcoal-appearance@local', 'charcoal-topbar@local', 'charcoal-widgets@local',
            'theme-consumers-test@local']);
        const launchers = Main.extensionManager.lookup('charcoal-launchers@local')?.stateObj;
        const appearance = Main.extensionManager.lookup('charcoal-appearance@local')?.stateObj;
        const themes = Main.extensionManager.lookup('charcoal-themes@local')?.stateObj;
        const topbar = Main.extensionManager.lookup('charcoal-topbar@local')?.stateObj;
        const widgets = Main.extensionManager.lookup('charcoal-widgets@local')?.stateObj;
        check(launchers?._settings && appearance?._settings && themes?._settings && topbar?._prefs && widgets?._settings,
            'extensions did not enable');
        launchers._settings.set_boolean('follow-theme', true);
        appearance._settings.set_boolean('follow-theme', true);
        topbar._prefs.set_boolean('follow-theme', true);
        widgets._settings.set_boolean('follow-theme', true);
        themes._settings.set_string('requested-theme-id', 'night');
        await pause(400);
        check(launchers._wheel.settings.get_int('wheel-radius') === 180, 'wheel radius ignored theme');
        check(launchers._search.settings.get_int('launcher-width') === 800, 'search width ignored theme');
        check(launchers._settings.get_strv('favorites').length === launchers._wheel.settings.get_strv('favorites').length,
            'favorites changed');
        check(appearance._desktop.get('icon-theme').get_string('icon-theme') === 'Adwaita', 'icon choice ignored theme');
        check(topbar._theme.get_int('bar-height') === 42, 'topbar height ignored theme');
        check(widgets._theme.get_string('background-color') === '#112233', 'widget color ignored theme');
        topbar._prefs.set_int('bar-height', 36);
        topbar._theme.selectOverride('bar-height');
        launchers._settings.set_int('wheel-radius', 140);
        launchers._theme.selectOverride('wheel-radius');
        appearance._settings.set_string('icon-theme', 'hicolor');
        appearance._theme.selectOverride('icon-theme');
        check(topbar._theme.get_int('bar-height') === 36, 'topbar local override failed');
        check(launchers._theme.get_int('wheel-radius') === 140, 'launcher local override failed');
        check(appearance._desktop.get('icon-theme').get_string('icon-theme') === 'hicolor', 'icon local override failed');
        const moved = '{"music":{"monitor":0,"x":0.8,"y":0.7}}';
        widgets._theme.set_string('positions', moved);
        check(widgets._theme.get_string('positions') === moved, 'widget local placement override failed');
        themes._settings.set_string('requested-theme-id', 'charcoal-default');
        await pause(350);
        check(topbar._theme.get_int('bar-height') !== 36, 'topbar override remained active after switch');
        check(launchers._theme.get_int('wheel-radius') !== 140, 'launcher override remained active after switch');
        check(appearance._theme.get_string('icon-theme') !== 'hicolor', 'icon override remained active after switch');
        check(widgets._theme.get_string('positions') !== moved, 'theme switch did not make widget override dormant');
        topbar._theme.selectOverride('bar-height');
        launchers._theme.selectOverride('wheel-radius');
        appearance._theme.selectOverride('icon-theme');
        widgets._theme.selectOverride('positions');
        check(topbar._theme.get_int('bar-height') === 36, 'saved topbar override did not restore');
        check(launchers._theme.get_int('wheel-radius') === 140, 'saved launcher override did not restore');
        check(appearance._theme.get_string('icon-theme') === 'hicolor', 'saved icon override did not restore');
        check(widgets._theme.get_string('positions') === moved, 'saved widget position did not restore');
        launchers._settings.set_boolean('follow-theme', false);
        appearance._settings.set_boolean('follow-theme', false);
        await pause(200);
        check(launchers._wheel.settings.get_int('wheel-radius') === 140, 'unlinked wheel did not restore local');
        check(appearance._desktop.get('icon-theme').get_string('icon-theme') === appearance._settings.get_string('icon-theme'),
            'unlinked icon choice did not restore local');
        // A user's later desktop choice belongs to the user, even when Appearance is disabled.
        const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        desktop.set_string('icon-theme', 'user-external-choice');
        appearance.disable();
        check(desktop.get_string('icon-theme') === 'user-external-choice', 'disable overwrote external icon choice');
        appearance.enable();
        // Exercise actual cleanup/re-enable of every component with pending redraw work.
        for (const extension of [launchers, widgets, topbar, appearance, themes]) {
            extension.disable();
            extension.enable();
        }
        await pause(400);
        check(launchers._input && widgets._container && topbar._surface && appearance._desktop && themes._store,
            'extensions failed to re-enable');
        console.log('THEME CONSUMERS PASS');
        global.context.terminate();
    }
}
