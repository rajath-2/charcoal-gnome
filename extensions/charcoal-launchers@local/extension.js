import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import {searchColorCss} from './policy.js';
import {color} from './appearance.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {FavoritesWheel} from './wheel.js';
import {CursorMinimize} from './windows.js';
import {SearchLauncher} from './search.js';
import {InputController} from './input.js';
import {DockIntegration} from './dock.js';
import {ThemeClient} from './theme-client.js';

export default class CharcoalLaunchers extends Extension {
    enable() {
        this._settings = this.getSettings();
        // Colors used to be shared: start the wheel's own colors from the user's previous choice.
        if (!this._settings.get_boolean('wheel-colors-split')) {
            for (const key of ['background-color', 'foreground-color', 'accent-color'])
                if (this._settings.get_user_value(key)) this._settings.set_string(`wheel-${key}`, this._settings.get_string(key));
            this._settings.set_boolean('wheel-colors-split', true);
        }
        if (!this._settings.get_boolean('favorites-initialized')) {
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            this._settings.set_strv('favorites', shell.get_strv('favorite-apps').slice(0, 12));
            this._settings.set_boolean('favorites-initialized', true);
        }
        this._theme = new ThemeClient('launchers', this._settings);
        this._unwatchTheme = this._theme.connectChanged(() => this._scheduleConfigure());
        this._dock = new DockIntegration(this._theme);
        this._wheel = new FavoritesWheel(this._theme);
        this._search = new SearchLauncher(this._theme, () => this.openPreferences());
        if (Main.layoutManager._startingUp)
            this._startup = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startup); this._startup = 0; this._configure();
            });
        else this._configure();
        this._changed = this._settings.connect('changed', (_, key) => {
            if (['owned-bindings', 'owned-dock', 'status', 'favorites-initialized'].includes(key)) return;
            this._scheduleConfigure();
        });
        this._sessionChanged = Main.sessionMode.connect('updated', () => this._cancel());
        this._monitorChanged = Main.layoutManager.connect('monitors-changed', () => { this._cancel(); this._dock.update(); });
        this._extensionChanged = Main.extensionManager.connect('extension-state-changed', (_, ext) => {
            if (ext.uuid === 'dash-to-dock@micxgx.gmail.com') this._dock.update();
            if (ext.uuid === 'blur-my-shell@aunetx') this._search.close(true);
        });
    }
    _scheduleConfigure() {
        this._cancel();
        if (this._reload) GLib.Source.remove(this._reload);
        this._reload = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._reload = 0; this._configure(); return GLib.SOURCE_REMOVE;
        });
    }
    _configure() {
        this._loadStyle();
        this._input?.destroy();
        this._input = new InputController(this._theme, this._wheel, this._search);
        this._input.enable();
        this._dock.update();
        this._cursorMinimize?.disable();
        this._cursorMinimize = null;
        if (this._settings.get_boolean('wheel-enabled') && this._settings.get_boolean('dock-mode')) {
            this._cursorMinimize = new CursorMinimize();
            this._cursorMinimize.enable();
        }
    }
    // Generated from preferences; a new file per change makes St reparse it.
    _loadStyle() {
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'charcoal-launchers']);
        GLib.mkdir_with_parents(dir, 0o700);
        const file = Gio.File.new_for_path(`${dir}/style-${GLib.uuid_string_random()}.css`);
        const css = searchColorCss(color(this._theme, 'foreground-color'), color(this._theme, 'accent-color'));
        file.replace_contents(new TextEncoder().encode(css), null, false, Gio.FileCreateFlags.NONE, null);
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
        this._unloadStyle();
        this._styleFile = file;
    }
    _unloadStyle() {
        if (!this._styleFile) return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._styleFile);
        this._styleFile.delete(null);
        this._styleFile = null;
    }
    _cancel() { this._input?.cancel(); this._wheel?.close(true); this._search?.close(true); }
    disable() {
        this._unwatchTheme?.();
        this._unwatchTheme = null;
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
        this._cursorMinimize?.disable(); this._cursorMinimize = null;
        this._wheel?.destroy(); this._wheel = null;
        this._search?.destroy(); this._search = null;
        this._unloadStyle();
        this._theme?.destroy();
        this._theme = null;
        this._settings = null;
    }
}
