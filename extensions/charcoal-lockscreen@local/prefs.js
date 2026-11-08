import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {ELEMENTS, readValues, previewPlacements} from './policy.js';
import {ThemeClient} from './theme-client.js';
import {attachThemeControls} from './theme-controls.js';

const TITLES = {clock: 'Clock', date: 'Date', user: 'User', prompt: 'Password prompt', status: 'Status',
    notifications: 'Notifications', text: 'Text', image: 'Image'};

// '' when `path` is an existing regular image file, else the reason it cannot be used.
function fileError(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info('standard::type,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() !== Gio.FileType.REGULAR) return `Not a regular file: ${path}`;
        return Gio.content_type_is_mime_type(info.get_content_type(), 'image/*') ? '' : `Not an image: ${path}`;
    } catch (error) {
        return `Cannot read ${path}: ${error.message}`;
    }
}

// The monitor the preview stands for, in the same logical pixels the shell lays out in.
function previewMonitor() {
    // shortcut: GTK4 cannot tell which monitor is primary, so the first one is used; fine for one monitor.
    const geometry = Gdk.Display.get_default()?.get_monitors().get_item(0)?.get_geometry();
    return geometry?.width > 0 && geometry?.height > 0 ? {width: geometry.width, height: geometry.height}
        : {width: 1920, height: 1080};
}

export default class CharcoalLockscreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new ThemeClient('lockscreen', settings);
        window.set_default_size(680, 820);
        const signals = [];
        const page = new Adw.PreferencesPage({title: 'Lock screen', icon_name: 'system-lock-screen-symbolic'});
        window.add(page);
        const group = (title, description = '') => {
            const g = new Adw.PreferencesGroup({title, description}); page.add(g); return g;
        };

        const statusGroup = group('Status');
        const status = new Adw.ActionRow({title: 'Lock screen status', subtitle: settings.get_string('status') || 'No errors'});
        statusGroup.add(status);
        const report = text => { status.subtitle = text || 'No errors'; };
        signals.push(settings.connect('changed::status', () => report(settings.get_string('status'))));

        // Preview: the shell's own layout policy on this monitor, scaled down. Drag a box to move it.
        const monitor = previewMonitor();
        const previewGroup = group('Preview', `As laid out on a ${monitor.width}×${monitor.height} screen. Drag an element to move it.`);
        const area = new Gtk.DrawingArea({content_width: 480, content_height: Math.round(480 * monitor.height / monitor.width),
            halign: Gtk.Align.CENTER, margin_top: 6, margin_bottom: 6});
        previewGroup.add(area);
        let values, placements = {}, scale = 1, dragging = null;
        const update = () => { values = readValues(client); area.queue_draw(); };
        area.set_draw_func((_, cr, width, height) => {
            scale = Math.min(width / monitor.width, height / monitor.height);
            placements = previewPlacements(values, monitor, scale);
            cr.setSourceRGB(0.08, 0.07, 0.05);
            cr.rectangle(0, 0, monitor.width * scale, monitor.height * scale);
            cr.fill();
            cr.setFontSize(11);
            for (const name of ELEMENTS) {
                const r = placements[name];
                if (!r?.visible) continue;
                const x = dragging?.name === name ? dragging.x : r.x, y = dragging?.name === name ? dragging.y : r.y;
                cr.save();
                cr.rectangle(x, y, r.width, r.height);
                cr.setSourceRGBA(0.85, 0.56, 0.24, name === 'prompt' ? 0.35 : 0.18);
                cr.fillPreserve();
                cr.setSourceRGB(0.85, 0.56, 0.24);
                cr.setLineWidth(1);
                cr.stroke();
                cr.rectangle(x, y, r.width, r.height);
                cr.clip();
                cr.setSourceRGB(0.95, 0.93, 0.89);
                cr.moveTo(x + 3, y + 12);
                cr.showText(TITLES[name]);
                cr.restore();
            }
            cr.$dispose();
        });
        const drag = new Gtk.GestureDrag();
        drag.connect('drag-begin', (_, px, py) => {
            const name = [...ELEMENTS].reverse().find(n => {
                const r = placements[n];
                return r?.visible && px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
            });
            dragging = name ? {name, x0: placements[name].x, y0: placements[name].y, x: placements[name].x, y: placements[name].y} : null;
        });
        drag.connect('drag-update', (_, dx, dy) => {
            if (!dragging) return;
            dragging.x = dragging.x0 + dx; dragging.y = dragging.y0 + dy;
            area.queue_draw();
        });
        drag.connect('drag-end', (_, dx, dy) => {
            if (!dragging) return;
            const {name, x0, y0} = dragging, e = values.elements[name];
            dragging = null;
            const fraction = (v, size, span) => Math.round(Math.min(1 - span, Math.max(0, v / scale / size)) * 10000) / 10000;
            settings.set_double(`${name}-x`, fraction(x0 + dx, monitor.width, e.w));
            settings.set_double(`${name}-y`, fraction(y0 + dy, monitor.height, e.h));
        });
        area.add_controller(drag);

        // Numeric controls for each element, as fractions of the screen.
        const layout = group('Elements', 'Position and size as fractions of the screen (0–1). The password prompt is always shown and kept on screen.');
        for (const name of ELEMENTS) {
            const row = new Adw.ExpanderRow({title: TITLES[name]});
            for (const [field, label, min] of [['x', 'Left', 0], ['y', 'Top', 0], ['w', 'Width', 0.02], ['h', 'Height', 0.02]]) {
                const spin = Adw.SpinRow.new_with_range(min, 1, 0.01);
                spin.title = label; spin.digits = 3;
                settings.bind(`${name}-${field}`, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
                row.add_row(spin);
            }
            if (name !== 'prompt') {
                const shown = new Adw.SwitchRow({title: 'Shown'});
                settings.bind(`${name}-visible`, shown, 'active', Gio.SettingsBindFlags.DEFAULT);
                row.add_row(shown);
            }
            layout.add(row);
        }

        const style = group('Style', 'Shared by all elements unless an element has its own style below.');
        const family = new Adw.EntryRow({title: 'Font family', text: settings.get_string('font-family'), show_apply_button: true});
        family.connect('apply', () => {
            if (/^[\w .-]{1,64}$/.test(family.text)) settings.set_string('font-family', family.text);
            else report('Font family may use letters, digits, spaces, dots and dashes (64 at most)');
        });
        style.add(family);
        for (const [key, label, min, max, step] of [['font-weight', 'Font weight', 100, 900, 100], ['font-size', 'Font size', 8, 200, 1],
            ['border-width', 'Border width', 0, 16, 1], ['border-radius', 'Corner radius', 0, 64, 1],
            ['shadow-size', 'Shadow size', 0, 64, 1], ['spacing', 'Spacing', 0, 64, 1]]) {
            const spin = Adw.SpinRow.new_with_range(min, max, step);
            spin.title = label;
            settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
            style.add(spin);
        }
        for (const [key, label] of [['text-color', 'Text color'], ['accent-color', 'Accent color'], ['panel-color', 'Panel color']]) {
            const row = new Adw.ActionRow({title: label});
            const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
            const sync = () => { const rgba = new Gdk.RGBA(); rgba.parse(settings.get_string(key)); picker.rgba = rgba; };
            sync(); signals.push(settings.connect(`changed::${key}`, sync));
            picker.connect('notify::rgba', () => {
                const c = picker.rgba;
                const hex = `#${[c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
                if (settings.get_string(key) !== hex) settings.set_string(key, hex);
            });
            row.add_suffix(picker); style.add(row);
        }
        const perElement = new Adw.EntryRow({title: 'Per-element styles (JSON)', text: settings.get_string('element-styles'), show_apply_button: true});
        perElement.connect('apply', () => {
            let parsed;
            try { parsed = JSON.parse(perElement.text); } catch { parsed = null; }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                report('Per-element styles must be a JSON object, e.g. {"clock": {"font-size": 96, "align": "start"}}');
                return;
            }
            settings.set_string('element-styles', perElement.text);
            report('');
        });
        signals.push(settings.connect('changed::element-styles', () => { perElement.text = settings.get_string('element-styles'); }));
        style.add(perElement);

        const content = group('Content and background', 'Image and background files stay on this computer. The lock wallpaper can differ from the desktop wallpaper.');
        const text = new Adw.EntryRow({title: 'Decorative text (never part of a theme)', text: settings.get_string('text-content'), show_apply_button: true});
        text.connect('apply', () => settings.set_string('text-content', text.text));
        content.add(text);
        const fileRow = (key, title) => {
            const row = new Adw.ActionRow({title});
            const describe = () => { row.subtitle = settings.get_string(key) || 'None'; };
            describe(); signals.push(settings.connect(`changed::${key}`, describe));
            const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
            choose.connect('clicked', () => {
                const filter = new Gtk.FileFilter({name: 'Images'});
                filter.add_mime_type('image/*');
                const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
                filters.append(filter);
                new Gtk.FileDialog({title, filters, default_filter: filter}).open(window, null, (dialog, result) => {
                    let path;
                    try { path = dialog.open_finish(result)?.get_path(); } catch { return; }
                    if (!path) return;
                    // Validate before the path is saved (and so before it can be saved to a theme).
                    const error = fileError(path);
                    if (error) { report(error); return; }
                    settings.set_string(key, path);
                    report('');
                });
            });
            const clear = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
            clear.connect('clicked', () => settings.set_string(key, ''));
            row.add_suffix(choose); row.add_suffix(clear);
            content.add(row);
        };
        fileRow('image-uri', 'Decorative image');
        fileRow('lock-wallpaper', 'Lock screen wallpaper');

        attachThemeControls(window, page, settings, 'lockscreen');

        const reset = group('Reset', 'Returns layout, style and content to their defaults and stops following the theme. To get GNOME’s own lock screen back, turn this extension off.');
        const resetRow = new Adw.ActionRow({title: 'Reset lock screen'});
        const resetButton = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        resetButton.connect('clicked', () => {
            // Unlink first so resetting values does not record them as theme overrides.
            settings.reset('follow-theme');
            for (const key of settings.settings_schema.list_keys())
                if (key !== 'follow-theme' && key !== 'override-activations') settings.reset(key);
            settings.reset('override-activations');
            report('');
        });
        resetRow.add_suffix(resetButton); reset.add(resetRow);

        signals.push(settings.connect('changed', update));
        const unwatch = client.connectChanged(update);
        window.connect('close-request', () => {
            signals.forEach(id => settings.disconnect(id));
            unwatch(); client.destroy();
            return false;
        });
        update();
    }
}
