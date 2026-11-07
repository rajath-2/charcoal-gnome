import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {FavoritesWheel} from './wheel.js';
import {SearchLauncher} from './search.js';
import {InputController} from './input.js';
import {DockIntegration} from './dock.js';

export default class CharcoalLaunchers extends Extension {
    enable() {
        this._settings = this.getSettings();
        if (!this._settings.get_boolean('favorites-initialized')) {
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            this._settings.set_strv('favorites', shell.get_strv('favorite-apps').slice(0, 12));
            this._settings.set_boolean('favorites-initialized', true);
        }
        this._dock = new DockIntegration(this._settings);
        this._wheel = new FavoritesWheel(this._settings);
        this._search = new SearchLauncher(this._settings, () => this.openPreferences());
        if (Main.layoutManager._startingUp)
            this._startup = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startup); this._startup = 0; this._configure();
            });
        else this._configure();
        this._changed = this._settings.connect('changed', (_, key) => {
            if (['owned-bindings', 'status', 'favorites-initialized'].includes(key)) return;
            this._cancel();
            if (this._reload) GLib.Source.remove(this._reload);
            this._reload = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._reload = 0; this._configure(); return GLib.SOURCE_REMOVE;
            });
        });
        this._sessionChanged = Main.sessionMode.connect('updated', () => this._cancel());
        this._monitorChanged = Main.layoutManager.connect('monitors-changed', () => { this._cancel(); this._dock.update(); });
        this._extensionChanged = Main.extensionManager.connect('extension-state-changed', (_, ext) => {
            if (ext.uuid === 'dash-to-dock@micxgx.gmail.com') this._dock.update();
            if (ext.uuid === 'blur-my-shell@aunetx') this._search.close(true);
        });
    }
    _configure() {
        this._input?.destroy();
        this._input = new InputController(this._settings, this._wheel, this._search);
        this._input.enable();
        this._dock.update();
    }
    _cancel() { this._input?.cancel(); this._wheel?.close(true); this._search?.close(true); }
    disable() {
        if (this._startup) Main.layoutManager.disconnect(this._startup);
        this._startup = 0;
        if (this._reload) GLib.Source.remove(this._reload);
        this._reload = 0;
        if (this._changed) this._settings.disconnect(this._changed);
        if (this._sessionChanged) Main.sessionMode.disconnect(this._sessionChanged);
        if (this._monitorChanged) Main.layoutManager.disconnect(this._monitorChanged);
        this._changed = this._sessionChanged = this._monitorChanged = 0;
        if (this._extensionChanged) Main.extensionManager.disconnect(this._extensionChanged);
        this._extensionChanged = 0;
        this._dock?.destroy(); this._dock = null;
        this._input?.destroy(); this._input = null;
        this._wheel?.destroy(); this._wheel = null;
        this._search?.destroy(); this._search = null;
        this._settings = null;
    }
}
