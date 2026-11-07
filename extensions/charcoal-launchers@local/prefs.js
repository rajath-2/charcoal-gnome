import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CharcoalPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 780);
        window.search_enabled = true;
        const signals = [];
        const watch = (key, callback) => signals.push(settings.connect(`changed::${key}`, callback));
        window.connect('close-request', () => { signals.forEach(id => settings.disconnect(id)); return false; });
        const page = (title, icon) => {
            const p = new Adw.PreferencesPage({title, icon_name: icon}); window.add(p); return p;
        };
        const group = (p, title, description = '') => {
            const g = new Adw.PreferencesGroup({title, description}); p.add(g); return g;
        };
        const toggle = (g, key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT); g.add(row); return row;
        };
        const spin = (g, key, title, min, max, step, subtitle = '') => {
            const row = Adw.SpinRow.new_with_range(min, max, step);
            row.title = title; row.subtitle = subtitle;
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT); g.add(row);
        };
        const general = page('General', 'preferences-system-symbolic');
        const launchers = group(general, 'Launchers');
        toggle(launchers, 'search-enabled', 'Multipurpose search', 'Open apps, files, calculations and settings');
        toggle(launchers, 'wheel-enabled', 'Favorites wheel', 'Hold Super, point at an app, release to launch. Release in the center to cancel.');

        const wheelPage = page('Wheel', 'starred-symbolic');
        const behaviour = group(wheelPage, 'Behaviour');
        spin(behaviour, 'hold-delay', 'Super hold delay', 150, 1500, 50, 'Milliseconds before the wheel appears');
        toggle(behaviour, 'dock-mode', 'Radial dock mode', 'Running apps in outer rings, normal dock hidden. Windows open from and minimize into the cursor: release on the focused app to minimize it');
        toggle(behaviour, 'desktop-dock', 'Also show desktop dock', 'Keep your bottom dock alongside the hold-Super wheel');
        const appGroup = group(wheelPage, 'Favorite applications', 'Up to 12 apps, arranged clockwise from the top. This list is independent of your dock.');
        const add = new Gtk.Button({label: 'Add application', css_classes: ['suggested-action'], valign: Gtk.Align.CENTER});
        appGroup.header_suffix = add;
        let favoriteRows = [];
        const rebuild = () => {
            favoriteRows.forEach(row => appGroup.remove(row)); favoriteRows = [];
            const ids = settings.get_strv('favorites'); add.sensitive = ids.length < 12;
            const appMap = new Map(Gio.AppInfo.get_all().map(info => [info.get_id(), info]));
            ids.forEach((id, index) => {
                const info = appMap.get(id);
                const row = new Adw.ActionRow({title: info?.get_name() ?? 'Application unavailable', subtitle: id, use_markup: false});
                if (info?.get_icon()) row.add_prefix(new Gtk.Image({gicon: info.get_icon(), pixel_size: 28}));
                const button = (icon, tip, callback, sensitive = true) => {
                    const b = new Gtk.Button({icon_name: icon, tooltip_text: tip, valign: Gtk.Align.CENTER, sensitive});
                    b.connect('clicked', callback); row.add_suffix(b);
                };
                const move = delta => {
                    const list = settings.get_strv('favorites');
                    [list[index], list[index + delta]] = [list[index + delta], list[index]];
                    settings.set_strv('favorites', list);
                };
                button('go-up-symbolic', 'Move counterclockwise', () => move(-1), index > 0);
                button('go-down-symbolic', 'Move clockwise', () => move(1), index < ids.length - 1);
                button('user-trash-symbolic', 'Remove favorite', () => settings.set_strv('favorites', settings.get_strv('favorites').filter(value => value !== id)));
                appGroup.add(row); favoriteRows.push(row);
            });
            if (!ids.length) {
                const row = new Adw.ActionRow({title: 'No favorites yet', subtitle: 'Use Add application to populate the wheel.'});
                appGroup.add(row); favoriteRows.push(row);
            }
        };
        add.connect('clicked', () => this._appPicker(window, settings));
        rebuild(); watch('favorites', rebuild);
        const wheelSize = group(wheelPage, 'Size');
        spin(wheelSize, 'wheel-radius', 'Wheel radius', 100, 300, 10, 'Logical pixels; automatically fits the monitor');
        spin(wheelSize, 'ring-width', 'Outer ring width', 40, 120, 4, 'Radial dock rings for running apps');
        spin(wheelSize, 'wheel-icon-size', 'Icon size', 20, 64, 2);
        spin(wheelSize, 'neutral-radius', 'Empty center size', 24, 80, 4, 'Move here and release Super to cancel');
        spin(wheelSize, 'sector-gap', 'Spacing between sectors', 0, 12, 1);
        const wheelLook = group(wheelPage, 'Look and motion');
        spin(wheelLook, 'wheel-opacity', 'Sector opacity', 40, 100, 1, 'Percent. Lower shows more of the blur');
        toggle(wheelLook, 'wheel-blur', 'Background blur', 'Blur behind the sectors. Static/live follows the search setting');
        spin(wheelLook, 'wheel-open-duration', 'Grow-out duration', 0, 500, 10, 'Milliseconds');
        spin(wheelLook, 'wheel-close-duration', 'Collapse duration', 0, 400, 10, 'Milliseconds');

        const searchPage = page('Search', 'system-search-symbolic');
        const keys = group(searchPage, 'Shortcut');
        const shortcut = new Adw.ActionRow({title: 'Search shortcut', subtitle: 'Super+Space replaces keyboard layout switching while enabled'});
        const shortcutButton = new Gtk.Button({valign: Gtk.Align.CENTER});
        const updateShortcut = () => { shortcutButton.label = settings.get_strv('launcher-shortcut').join(', ') || 'Set shortcut'; };
        updateShortcut(); watch('launcher-shortcut', updateShortcut);
        shortcutButton.connect('clicked', () => this._shortcut(window, settings));
        shortcut.add_suffix(shortcutButton); keys.add(shortcut);
        const status = new Adw.ActionRow({title: 'Shortcut status'});
        const updateStatus = () => { status.subtitle = settings.get_string('status') || 'No conflicts reported'; };
        updateStatus(); watch('status', updateStatus); keys.add(status);
        const categories = group(searchPage, 'Search categories', 'Files follow GNOME’s search index. Desktop Search privacy settings are respected.');
        toggle(categories, 'search-apps', 'Applications');
        toggle(categories, 'search-files', 'Files and folders');
        toggle(categories, 'search-calculator', 'Calculations', 'Enter copies the result when the Calculator provider supplies it');
        toggle(categories, 'search-settings', 'System settings');
        spin(categories, 'result-limit', 'Results per category', 3, 20, 1);
        const searchSize = group(searchPage, 'Size');
        spin(searchSize, 'launcher-width', 'Panel width', 360, 1000, 20);
        spin(searchSize, 'search-max-height', 'Maximum height', 30, 90, 2, 'Percent of the screen');
        spin(searchSize, 'search-icon-size', 'Result icon size', 20, 64, 2);
        spin(searchSize, 'corner-radius', 'Corner radius', 0, 40, 2);
        const searchLook = group(searchPage, 'Look and motion');
        spin(searchLook, 'background-opacity', 'Panel opacity', 40, 100, 1, 'Percent');
        toggle(searchLook, 'blur', 'Background blur', 'Uses your Blur My Shell popup pipeline');
        toggle(searchLook, 'static-blur', 'Static blur', 'Search and wheel: blur the wallpaper only. Off: live blur of windows behind (more GPU)');
        spin(searchLook, 'open-duration', 'Grow-in duration', 0, 500, 10, 'Milliseconds');
        spin(searchLook, 'close-duration', 'Closing duration', 0, 400, 10, 'Milliseconds');

        const appearance = page('Appearance', 'applications-graphics-symbolic');
        const colors = group(appearance, 'Colors', 'Shared by the wheel and search');
        for (const [key, title] of [['background-color', 'Background'], ['foreground-color', 'Text'], ['accent-color', 'Highlight']]) {
            const row = new Adw.ActionRow({title});
            const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
            const update = () => { const rgba = new Gdk.RGBA(); rgba.parse(settings.get_string(key)); picker.rgba = rgba; };
            update(); watch(key, update);
            picker.connect('notify::rgba', () => {
                const c = picker.rgba;
                const hex = '#' + [c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
                if (settings.get_string(key) !== hex) settings.set_string(key, hex);
            });
            row.add_suffix(picker); colors.add(row);
        }
        const motion = group(appearance, 'Motion', 'The system’s reduced-animation setting always takes precedence.');
        toggle(motion, 'animations', 'Animate opening and closing');
        toggle(motion, 'scale-animation', 'Grow and shrink', 'Off: fade only');
        const resetGroup = group(appearance, 'Defaults');
        const reset = new Adw.ActionRow({title: 'Reset launcher preferences', subtitle: 'Restores appearance and controls, and copies favorites from your dock again.'});
        const resetButton = new Gtk.Button({label: 'Reset…', css_classes: ['destructive-action'], valign: Gtk.Align.CENTER});
        resetButton.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({heading: 'Reset launcher preferences?', body: 'Your custom colors, shortcuts and favorites list will be replaced.'});
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('reset', 'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.default_response = 'cancel'; dialog.close_response = 'cancel';
            dialog.choose(window, null, (source, result) => {
                if (source.choose_finish(result) !== 'reset') return;
                for (const key of settings.settings_schema.list_keys())
                    if (!['owned-bindings', 'status', 'favorites', 'favorites-initialized'].includes(key)) settings.reset(key);
                settings.set_strv('favorites', new Gio.Settings({schema_id: 'org.gnome.shell'}).get_strv('favorite-apps').slice(0, 12));
                settings.set_boolean('favorites-initialized', true);
            });
        });
        reset.add_suffix(resetButton); resetGroup.add(reset);
    }
    _shortcut(parent, settings) {
        const dialog = new Adw.Window({title: 'Set search shortcut', transient_for: parent, modal: true,
            default_width: 420, default_height: 180, resizable: false});
        const view = new Adw.ToolbarView(); view.add_top_bar(new Adw.HeaderBar());
        const label = new Gtk.Label({label: 'Press a key combination\nEscape cancels', margin_top: 32, margin_bottom: 32});
        view.content = label; dialog.content = view;
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) { dialog.close(); return true; }
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (!mods || !Gtk.accelerator_valid(keyval, mods)) return true;
            settings.set_strv('launcher-shortcut', [Gtk.accelerator_name(keyval, mods)]);
            dialog.close(); return true;
        });
        dialog.add_controller(controller); dialog.present();
    }
    _appPicker(parent, settings) {
        const dialog = new Adw.Window({title: 'Add favorite application', transient_for: parent,
            modal: true, default_width: 480, default_height: 560});
        const view = new Adw.ToolbarView(); view.add_top_bar(new Adw.HeaderBar());
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_start: 12, margin_end: 12, margin_bottom: 12});
        const search = new Gtk.SearchEntry({placeholder_text: 'Find an application'}); content.append(search);
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        const ids = new Set(settings.get_strv('favorites'));
        const apps = Gio.AppInfo.get_all().filter(app => app.should_show() && app.get_id() && !ids.has(app.get_id()))
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        for (const app of apps) {
            const row = new Adw.ActionRow({title: app.get_name(), subtitle: app.get_id(), activatable: true, use_markup: false});
            row._searchText = `${app.get_name()} ${app.get_id()}`.toLocaleLowerCase();
            if (app.get_icon()) row.add_prefix(new Gtk.Image({gicon: app.get_icon(), pixel_size: 28}));
            row.connect('activated', () => {
                const current = settings.get_strv('favorites');
                if (current.length < 12 && !current.includes(app.get_id())) settings.set_strv('favorites', [...current, app.get_id()]);
                dialog.close();
            }); list.append(row);
        }
        list.set_filter_func(row => row._searchText.includes(search.text.toLocaleLowerCase()));
        search.connect('search-changed', () => list.invalidate_filter());
        const scroll = new Gtk.ScrolledWindow({vexpand: true, child: list}); content.append(scroll);
        view.content = content; dialog.content = view; dialog.present();
    }
}
