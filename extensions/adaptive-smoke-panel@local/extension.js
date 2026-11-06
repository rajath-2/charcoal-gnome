import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {useIslands} from './policy.js';
import {paintMorph} from './morph.js';
import {installMenuHandoff} from './menuHandoff.js';

export default class AdaptiveSmokePanel extends Extension {
    enable() {
        this._signals = [];
        this._windows = new Map();
        this._pending = 0;
        this._lastMode = null;
        this._timeline = null;
        this._progress = null;
        this._blurGroup = null;
        this._blur = this._settings('blur-my-shell@aunetx', 'org.gnome.shell.extensions.blur-my-shell.panel');
        this._theme = this._settings('user-theme@gnome-shell-extensions.gcampax.github.com', 'org.gnome.shell.extensions.user-theme');
        this._savedBlur = this._blur.get_boolean('blur');
        this._surface = new St.DrawingArea({reactive: false});
        Main.panel.insert_child_at_index(this._surface, 0);
        this._surface.connect('repaint', () => this._paint());
        this._connect(Main.panel, 'notify::allocation', () => this._allocateSurface());
        for (const box of [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox])
            this._connect(box, 'notify::allocation', () => this._surface.queue_repaint());
        this._connect(Main.panel.get_parent(), 'child-added', () => this._syncBlur());
        this._connect(this._theme, 'changed::name', () => this._queue());
        this._connect(global.display, 'window-created', (_, window) => {
            this._watch(window);
            this._queue();
        });
        this._connect(global.window_manager, 'switch-workspace', () => this._queue());
        this._connect(global.display, 'window-entered-monitor', () => this._queue());
        this._connect(global.display, 'window-left-monitor', () => this._queue());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._queue());
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
        this._update();
        this._restoreMenuHandoff = installMenuHandoff(Main.panel.menuManager, [
            Main.panel.statusArea.dateMenu?.menu,
            Main.panel.statusArea.quickSettings?.menu,
        ]);
    }

    _settings(uuid, schema) {
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', uuid, 'schemas']);
        const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
        return new Gio.Settings({settings_schema: source.lookup(schema, true)});
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _watch(window) {
        if (!window || this._windows.has(window))
            return;
        const ids = ['size-changed', 'notify::maximized-horizontally',
            'notify::maximized-vertically', 'notify::minimized', 'workspace-changed']
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
        if (!['Waybar-GNOME', 'Waybar-GNOME-Islands'].includes(this._theme.get_string('name'))) {
            this._clear();
            return;
        }
        const monitor = Main.layoutManager.primaryIndex;
        const windows = global.workspace_manager.get_active_workspace().list_windows();
        const islands = useIslands(windows.map(window => ({
            visible: window.showing_on_its_workspace(),
            minimized: window.minimized,
            normal: window.get_window_type() === Meta.WindowType.NORMAL,
            monitor: window.get_monitor(),
            horizontal: window.maximized_horizontally,
            vertical: window.maximized_vertically,
        })), monitor);
        if (islands === this._lastMode)
            return;
        if (this._lastMode === null && !this._blur.get_boolean('blur'))
            this._blur.set_boolean('blur', true);
        Main.panel.add_style_class_name('adaptive-smoke');
        this._surface.show();
        this._animateShape(islands ? 1 : 0);
        this._lastMode = islands;
    }

    _allocateSurface() {
        if (!this._surface || !Main.panel.has_allocation())
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const bleed = 12 * scale;
        const box = new Clutter.ActorBox({x1: -bleed, y1: -bleed,
            x2: Main.panel.width + bleed, y2: Main.panel.height + bleed});
        this._surface.allocate(box);
        this._surface.queue_repaint();
        this._syncBlur();
    }

    _paint() {
        const cr = this._surface.get_context();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .map(box => ({x: box.x + box.translation_x, width: box.width}));
        paintMorph(cr, Main.panel.width, Main.panel.height, boxes, this._progress ?? 0, scale);
        cr.$dispose();
    }

    _animateShape(target) {
        this._timeline?.stop();
        this._timeline = null;
        const start = this._progress ?? target;
        const apply = value => {
            this._progress = value;
            this._surface.queue_repaint();
            this._syncBlur();
        };
        const finish = () => {
            apply(target);
            this._allocateSurface();
        };
        if (start === target || !St.Settings.get().enable_animations) {
            finish();
            return;
        }
        // Only the drawn gaps change; panel geometry and controls stay anchored.
        apply(start);
        this._allocateSurface();
        // Mutter needs a stage-bound actor to supply the animation frame clock.
        const timeline = new Clutter.Timeline({actor: Main.panel, duration: 420});
        timeline.set_progress_mode(Clutter.AnimationMode.EASE_IN_OUT_CUBIC);
        timeline.connect('new-frame', () => {
            apply(start + (target - start) * timeline.get_progress());
        });
        timeline.connect('completed', () => {
            finish();
            this._timeline = null;
        });
        this._timeline = timeline;
        timeline.start();
    }

    _syncBlur() {
        const group = Main.panel.get_parent().get_children()
            .find(actor => actor.name === 'bms-panel-backgroundgroup');
        if (!group || this._progress === null)
            return;
        if (group !== this._blurGroup) {
            this._blurGroup = group;
            this._originalBlurOpacity = group.opacity;
        }
        // Keep the pipeline allocated, but suppress its full-width strip over gaps.
        group.opacity = this._progress < 0.001
            ? this._originalBlurOpacity : 0;
    }

    _clear() {
        this._timeline?.stop();
        this._timeline = null;
        this._progress = null;
        this._surface?.hide();
        const group = Main.panel.get_parent().get_children()
            .find(actor => actor.name === 'bms-panel-backgroundgroup');
        if (group && group === this._blurGroup)
            group.opacity = this._originalBlurOpacity;
        this._blurGroup = null;
        Main.panel.remove_style_class_name('adaptive-islands');
        Main.panel.remove_style_class_name('adaptive-smoke');
        if (this._lastMode !== null)
            this._blur.set_boolean('blur', this._savedBlur);
        this._lastMode = null;
    }

    disable() {
        this._restoreMenuHandoff?.();
        this._restoreMenuHandoff = null;
        if (this._pending)
            GLib.Source.remove(this._pending);
        this._pending = 0;
        for (const [object, id] of this._signals ?? [])
            object.disconnect(id);
        for (const [window, ids] of this._windows ?? [])
            for (const id of ids)
                window.disconnect(id);
        this._clear();
        this._surface?.destroy();
        this._surface = null;
        this._signals = [];
        this._windows = null;
        this._theme = null;
        this._blur = null;
    }
}
