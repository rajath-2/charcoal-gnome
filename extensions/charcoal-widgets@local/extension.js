import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Card} from './card.js';
import {buildCss} from './theme.js';
import {isDesktopClear} from './policy.js';

const NAMES = ['weather', 'calendar', 'music'];
const Placeholder = GObject.registerClass(class Placeholder extends Card {
    _init(name, settings, ext) {
        super._init(name, settings, ext);
        this.body.add_child(new St.Label({text: name, style_class: 'charcoal-widget-title'}));
    }
});
const CARD_TYPES = {weather: Placeholder, calendar: Placeholder, music: Placeholder};
const REBUILD_KEYS = ['weather-enabled', 'calendar-enabled', 'music-enabled', 'blur', 'static-blur'];
const OWN_KEYS = ['positions', 'locked', 'weather-city', 'weather-latitude', 'weather-longitude', 'idle-artwork'];

export default class CharcoalWidgets extends Extension {
    enable() {
        this._signals = [];
        this._windows = new Map();
        this._cards = new Map();
        this._settings = this.getSettings();
        // Above the wallpaper, below every window; the window group is hidden in the overview.
        this._container = new Clutter.Actor({name: 'charcoal-widgets'});
        global.window_group.insert_child_above(this._container, Main.layoutManager._backgroundGroup);
        this._loadStyle();
        this._connect(this._settings, 'changed', (_, key) => this._settingChanged(key));
        this._connect(global.display, 'window-created', (_, window) => { this._watch(window); this._queue(); });
        this._connect(global.window_manager, 'switch-workspace', () => this._queue());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._queue());
        this._connect(global.display, 'window-entered-monitor', () => this._queue());
        this._connect(global.display, 'window-left-monitor', () => this._queue());
        this._connect(global.display, 'workareas-changed', () => this._placeAll());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._build());
        this._connect(Main.extensionManager, 'extension-state-changed', (_, ext) => {
            if (ext.uuid === 'blur-my-shell@aunetx') this._build();
        });
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
        if (Main.layoutManager._startingUp)
            this._connect(Main.layoutManager, 'startup-complete', () => this._build());
        else
            this._build();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _settingChanged(key) {
        if (key === 'positions') this._placeAll();
        else if (REBUILD_KEYS.includes(key)) this._build();
        else if (!OWN_KEYS.includes(key)) this._queueStyle();
    }

    _build() {
        this._cards.forEach(card => card.destroy());
        this._cards.clear();
        for (const name of NAMES) {
            if (!this._settings.get_boolean(`${name}-enabled`))
                continue;
            const card = new CARD_TYPES[name](name, this._settings, this);
            this._container.add_child(card);
            this._cards.set(name, card);
        }
        this._update();
    }

    _placeAll() {
        this._cards.forEach(card => card.shown && card.place());
        this._queue();
    }

    _watch(window) {
        if (!window || this._windows.has(window))
            return;
        const ids = ['notify::minimized', 'workspace-changed']
            .map(signal => window.connect(signal, () => this._queue()));
        ids.push(window.connect('unmanaged', () => {
            for (const id of this._windows.get(window) ?? [])
                window.disconnect(id);
            this._windows.delete(window);
            this._queue();
        }));
        this._windows.set(window, ids);
    }

    _queue() {
        if (this._pending)
            return;
        this._pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pending = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _update() {
        const windows = global.workspace_manager.get_active_workspace().list_windows().map(w => ({
            normal: w.get_window_type() === Meta.WindowType.NORMAL && !w.skip_taskbar,
            minimized: w.minimized,
            monitor: w.get_monitor(),
        }));
        for (const card of this._cards.values()) {
            if (!card.shown) card.place();
            card.setShown(isDesktopClear(windows, card.monitor));
        }
    }

    // Sliders emit many changes; restyle once they settle.
    _queueStyle() {
        if (this._styleTimer)
            GLib.Source.remove(this._styleTimer);
        this._styleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._styleTimer = 0;
            this._loadStyle();
            this._cards.forEach(card => card._syncBlur());
            return GLib.SOURCE_REMOVE;
        });
    }

    // The stylesheet is generated from preferences; a new file per change makes St reparse it.
    _loadStyle() {
        const values = Object.fromEntries(this._settings.settings_schema.list_keys()
            .map(key => [key, this._settings.get_value(key).deepUnpack()]));
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'charcoal-widgets']);
        GLib.mkdir_with_parents(dir, 0o700);
        const file = Gio.File.new_for_path(`${dir}/style-${GLib.uuid_string_random()}.css`);
        file.replace_contents(new TextEncoder().encode(buildCss(values)), null, false, Gio.FileCreateFlags.NONE, null);
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
        this._unloadStyle();
        this._styleFile = file;
    }

    _unloadStyle() {
        if (!this._styleFile)
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._styleFile);
        this._styleFile.delete(null);
        this._styleFile = null;
    }

    disable() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const [window, ids] of this._windows)
            ids.forEach(id => window.disconnect(id));
        this._windows.clear();
        if (this._pending) GLib.Source.remove(this._pending);
        if (this._styleTimer) GLib.Source.remove(this._styleTimer);
        this._pending = this._styleTimer = 0;
        this._cards.clear();
        this._container.destroy();
        this._container = null;
        this._unloadStyle();
        this._settings = null;
    }
}
