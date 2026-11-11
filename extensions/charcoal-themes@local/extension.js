import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ThemeStore, ensureDefaultTheme, installedComponentSettings} from './store.js';
import {activateTheme} from './activation.js';
import {applyWallpaper, restoreWallpaper, syncWallpaper} from './wallpaper.js';

export default class CharcoalThemes extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._store = new ThemeStore();
        ensureDefaultTheme(this._store, installedComponentSettings());
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._requestedSignal = this._settings.connect('changed::requested-theme-id', () => this._activateRequested());
        this._revisionSignal = this._settings.connect('changed::profile-revision', () => this._syncWallpaper());
        this._syncWallpaper();
        this._activateRequested();
    }

    _syncWallpaper() {
        const profile = this._store.get(this._settings.get_string('active-theme-id'));
        if (!profile) return;
        const result = syncWallpaper(profile, this._desktop, this._settings, this._settings.get_string('activation-id'));
        if (result) this._settings.set_string('status', result.ok ? '' : result.error);
    }

    _activateRequested() {
        const id = this._settings.get_string('requested-theme-id');
        if (!id) return;
        // Fresh object: activateTheme batches with delay(), and GSettings never leaves delay mode,
        // which would leave this._settings reading its own stale writes forever.
        activateTheme(id, this.getSettings(), this._store,
            (profile, activation) => applyWallpaper(profile, this._desktop, this._settings, activation),
            () => GLib.uuid_string_random());
        this._settings.set_string('requested-theme-id', '');
    }

    disable() {
        this._settings.disconnect(this._requestedSignal);
        this._settings.disconnect(this._revisionSignal);
        restoreWallpaper(this._desktop, this._settings);
        this._settings = this._store = this._desktop = null;
    }
}
