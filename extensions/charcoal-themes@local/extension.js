import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ThemeStore} from './store.js';
import {activateTheme} from './activation.js';
import {applyWallpaper, restoreWallpaper} from './wallpaper.js';

export default class CharcoalThemes extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._store = new ThemeStore();
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._requestedSignal = this._settings.connect('changed::requested-theme-id', () => this._activateRequested());
        const active = this._store.get(this._settings.get_string('active-theme-id'));
        if (active) {
            const result = applyWallpaper(active, this._desktop, this._settings);
            this._settings.set_string('status', result.ok ? '' : result.error);
        }
        this._activateRequested();
    }

    _activateRequested() {
        const id = this._settings.get_string('requested-theme-id');
        if (!id) return;
        activateTheme(id, this._settings, this._store,
            profile => applyWallpaper(profile, this._desktop, this._settings), () => GLib.uuid_string_random());
        this._settings.set_string('requested-theme-id', '');
    }

    disable() {
        this._settings.disconnect(this._requestedSignal);
        restoreWallpaper(this._desktop, this._settings);
        this._settings = this._store = this._desktop = null;
    }
}
