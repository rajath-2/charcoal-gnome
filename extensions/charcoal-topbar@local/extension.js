import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {useIslands} from './policy.js';
import {paintMorph, morphShapes, effectBox, BLEED} from './morph.js';
import {PanelMask} from './panelmask.js';
import {addBlur} from './blur.js';
import {buildCss, rgb01} from './theme.js';
import {installMenuHandoff} from './menuHandoff.js';
import {ContentTheme} from './contentTheme.js';
import {ThemeClient} from './theme-client.js';
import {effectiveSnapshot} from './theme-policy.js';

const MODE_CLASSES = ['charcoal-compact', 'charcoal-islands', 'adaptive-smoke'];

export default class CharcoalTopbar extends Extension {
    enable() {
        this._signals = [];
        this._windows = new Map();
        this._pending = 0;
        this._lastMode = null;
        this._timeline = null;
        this._progress = null;
        this._prefs = this.getSettings();
        this._theme = new ThemeClient('topbar', this._prefs);
        this._unwatchTheme = this._theme.connectChanged(() => this._applyPrefs());
        this._contentTheme = new ContentTheme([Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]);
        this._blur = this._settings('blur-my-shell@aunetx', 'org.gnome.shell.extensions.blur-my-shell.panel');
        this._popupBlur = this._settings('blur-my-shell@aunetx', 'org.gnome.shell.extensions.blur-my-shell.popup');
        // Restored on disable; lock screen keeps us enabled (session-modes), so this is a real toggle-off.
        this._saved = [[this._blur, 'blur'], [this._blur, 'static-blur'], [this._blur, 'corner-radius'],
            [this._popupBlur, 'static-blur']].map(([settings, key]) => [settings, key, settings.get_value(key)]);
        this._surface = new St.DrawingArea({reactive: false});
        Main.panel.insert_child_at_index(this._surface, 0);
        this._surface.connect('repaint', () => this._paint());
        this._connect(Main.panel, 'notify::allocation', () => this._allocateSurface());
        for (const box of [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox])
            this._connect(box, 'notify::allocation', () => this._surface.queue_repaint());
        this._connect(Main.panel.get_parent(), 'child-added', () => this._syncBlur());
        // Sliders emit many changes; restyle once they settle.
        this._connect(this._prefs, 'changed', () => {
            if (this._prefsTimer)
                GLib.Source.remove(this._prefsTimer);
            this._prefsTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._prefsTimer = 0;
                this._applyPrefs();
                return GLib.SOURCE_REMOVE;
            });
        });
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
        this._applyPrefs();
        this._restoreMenuHandoff = installMenuHandoff(Main.panel.menuManager, [
            Main.panel.statusArea.dateMenu?.menu,
            Main.panel.statusArea.quickSettings?.menu,
        ]);
    }

    // The stylesheet is generated from preferences; a new file per change makes St reparse it.
    _loadStyle() {
        const values = effectiveSnapshot(this._prefs, this._theme);
        this._style = {color: rgb01(values['bar-color']), line: rgb01(values['border-color']),
            opacity: values['bar-opacity'] / 100, border: values['border-opacity'] / 100, borderWidth: values['border-width'],
            radius: values['corner-radius'], shadow: values.shadow, shadowColor: rgb01(values['shadow-color']),
            shadowSize: values['shadow-size'], shadowOpacity: values['shadow-opacity'] / 100};
        const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'charcoal-topbar']);
        GLib.mkdir_with_parents(dir, 0o700);
        const file = Gio.File.new_for_path(`${dir}/style-${GLib.uuid_string_random()}.css`);
        file.replace_contents(new TextEncoder().encode(buildCss(values)), null, false, Gio.FileCreateFlags.NONE, null);
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(file);
        this._unloadStyle();
        this._styleFile = file;
        this._contentTheme.update(values['text-color'], values['bold-text']);
        this._surface?.queue_repaint();
    }

    _unloadStyle() {
        if (!this._styleFile)
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._styleFile);
        this._styleFile.delete(null);
        this._styleFile = null;
    }

    _applyPrefs() {
        this._loadStyle();
        const mode = this._theme.get_string('mode');
        const staticBlur = this._theme.get_boolean('static-blur');
        for (const settings of [this._blur, this._popupBlur])
            if (settings.get_boolean('static-blur') !== staticBlur)
                settings.set_boolean('static-blur', staticBlur);
        // Blur My Shell's strip is full width: only the compact bar matches it. Islands have none;
        // auto uses its own layer, masked to the morphing shape (_syncBlur).
        const blur = mode === 'compact';
        if (this._blur.get_boolean('blur') !== blur)
            this._blur.set_boolean('blur', blur);
        const radius = this._theme.get_int('corner-radius');
        if (this._blur.get_int('corner-radius') !== radius)
            this._blur.set_int('corner-radius', radius);
        this._clear();
        Main.panel.remove_style_class_name('charcoal-compact');
        Main.panel.remove_style_class_name('charcoal-islands');
        if (mode === 'auto')
            this._update();
        else
            Main.panel.add_style_class_name(`charcoal-${mode}`);
    }

    _settings(uuid, schema) {
        const dir = Main.extensionManager.lookup(uuid).dir.get_child('schemas').get_path();
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
        if (this._theme.get_string('mode') !== 'auto')
            return;
        const monitor = Main.layoutManager.primaryIndex;
        const windows = global.workspace_manager.get_active_workspace().list_windows();
        const islands = useIslands(windows.map(window => ({
            visible: window.showing_on_its_workspace(),
            minimized: window.minimized,
            normal: window.get_window_type() === Meta.WindowType.NORMAL,
            monitor: window.get_monitor(),
            horizontal: window.maximized_horizontally,
            vertical: window.maximized_vertically,
        })), monitor, this._theme.get_boolean('invert-auto'));
        if (islands === this._lastMode)
            return;
        Main.panel.add_style_class_name('adaptive-smoke');
        this._surface.show();
        this._animateShape(islands ? 1 : 0);
        this._lastMode = islands;
    }

    _allocateSurface() {
        if (!this._surface || !Main.panel.has_allocation())
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const bleed = BLEED * scale;
        const box = new Clutter.ActorBox({x1: -bleed, y1: -bleed,
            x2: Main.panel.width + bleed, y2: Main.panel.height + bleed});
        this._surface.allocate(box);
        this._surface.queue_repaint();
        this._syncBlur();
        if (this._blurLayer) {
            this._blurLayer.allocate(new Clutter.ActorBox({x1: 0, y1: 0, x2: Main.panel.width, y2: Main.panel.height}));
            // The static wallpaper copy is laid out in monitor coordinates.
            const [x, y] = Main.panel.get_transformed_position();
            this._blurStatic?.set_position(-x, -y);
        }
    }

    _paint() {
        const cr = this._surface.get_context();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .map(box => ({x: box.x + box.translation_x, width: box.width}));
        paintMorph(cr, Main.panel.width, Main.panel.height, boxes, this._progress ?? 0, scale, this._style);
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

    // Auto mode: a blur layer behind the surface, masked to exactly the shapes the surface paints.
    _syncBlur() {
        if (this._progress === null)
            return;
        if (!this._blurLayer) {
            this._blurLayer = new St.Widget({reactive: false, clip_to_allocation: true});
            this._mask = new PanelMask();
            this._blurLayer.add_effect(this._mask);
            Main.panel.insert_child_below(this._blurLayer, this._surface);
            const layer = this._blurLayer;
            addBlur(layer, this._theme.get_boolean('static-blur')).then(group => {
                if (group && layer === this._blurLayer) {
                    this._blurStatic = group;
                    this._allocateSurface();
                }
            });
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .map(box => ({x: box.x + box.translation_x, width: box.width}));
        const [stageX, stageY] = Main.panel.get_transformed_position();
        this._mask.setShapes([Main.panel.width, Main.panel.height],
            effectBox(stageX, stageY, Main.panel.width, Main.panel.height),
            morphShapes(Main.panel.width, Main.panel.height, boxes, this._progress, this._style.radius * scale));
    }

    _removeBlurLayer() {
        this._blurLayer?.destroy();
        this._blurLayer = this._mask = this._blurStatic = null;
    }

    _clear() {
        this._timeline?.stop();
        this._timeline = null;
        this._progress = null;
        this._surface?.hide();
        this._removeBlurLayer();
        Main.panel.remove_style_class_name('adaptive-smoke');
        this._lastMode = null;
    }

    disable() {
        this._unwatchTheme?.();
        this._unwatchTheme = null;
        this._theme?.destroy();
        this._theme = null;
        this._contentTheme?.destroy();
        this._contentTheme = null;
        this._restoreMenuHandoff?.();
        this._restoreMenuHandoff = null;
        if (this._pending)
            GLib.Source.remove(this._pending);
        if (this._prefsTimer)
            GLib.Source.remove(this._prefsTimer);
        this._prefsTimer = 0;
        this._pending = 0;
        for (const [object, id] of this._signals ?? [])
            object.disconnect(id);
        for (const [window, ids] of this._windows ?? [])
            for (const id of ids)
                window.disconnect(id);
        this._clear();
        for (const name of MODE_CLASSES)
            Main.panel.remove_style_class_name(name);
        for (const [settings, key, value] of this._saved ?? [])
            settings.set_value(key, value);
        this._saved = null;
        this._unloadStyle();
        this._surface?.destroy();
        this._surface = null;
        this._signals = [];
        this._windows = null;
        this._prefs = null;
        this._blur = null;
        this._popupBlur = null;
    }
}
