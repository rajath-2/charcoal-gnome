import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {THEME_KEYS} from './catalog.js';
import {ThemeStore, captureSettings, ensureDefaultTheme, installedComponentSettings} from './store.js';

const title = key => key.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase());

export default class CharcoalThemesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(680, 780);
        window.search_enabled = true;
        const settings = this.getSettings();
        const store = new ThemeStore();
        const componentSettings = installedComponentSettings();
        ensureDefaultTheme(store, componentSettings);
        const overview = new Adw.PreferencesPage({title: 'Themes', icon_name: 'applications-graphics-symbolic'});
        window.add(overview);
        const manage = new Adw.PreferencesGroup({title: 'Theme library'});
        overview.add(manage);
        const model = new Gtk.StringList();
        const chooser = new Adw.ComboRow({title: 'Selected theme', model});
        manage.add(chooser);
        const name = new Adw.EntryRow({title: 'Theme name', show_apply_button: true});
        manage.add(name);
        const status = new Adw.ActionRow({title: 'Status'});
        manage.add(status);
        const button = (label, action, destructive = false) => {
            const row = new Adw.ActionRow({title: label});
            const control = new Gtk.Button({label, valign: Gtk.Align.CENTER,
                css_classes: destructive ? ['destructive-action'] : []});
            control.connect('clicked', action);
            row.add_suffix(control); manage.add(row);
            return control;
        };
        let profiles = [];
        let selectedId = '';
        const selected = () => store.get(selectedId);
        const markRevision = () => settings.set_string('profile-revision', GLib.uuid_string_random());
        const save = (profile, rerender = true) => {
            try {
                store.save(profile); markRevision(); status.subtitle = `Saved ${profile.name}`;
                if (rerender) refresh(profile.id);
            }
            catch (error) { status.subtitle = error.message; }
        };
        const groups = {};
        const rows = {};
        for (const component of Object.keys(THEME_KEYS)) {
            const page = new Adw.PreferencesPage({title: title(component), icon_name: 'preferences-desktop-symbolic'});
            window.add(page);
            groups[component] = new Adw.PreferencesGroup({title: `${title(component)} theme values`});
            page.add(groups[component]);
            rows[component] = [];
        }
        const change = (component, key, value) => {
            const profile = selected();
            if (!profile) return;
            save({...profile, components: {...profile.components,
                [component]: {...(profile.components[component] ?? {}), [key]: value}}}, false);
        };
        const renderEditors = () => {
            const profile = selected();
            for (const [component, group] of Object.entries(groups)) {
                rows[component].forEach(row => group.remove(row));
                rows[component] = [];
                if (!profile) continue;
                const local = componentSettings[component];
                for (const [key, rule] of Object.entries(THEME_KEYS[component])) {
                    if (!local?.settings_schema.has_key(key)) continue;
                    const value = profile.components[component]?.[key] ?? local.get_value(key).deepUnpack();
                    let row;
                    if (rule.type === 'integer') {
                        row = Adw.SpinRow.new_with_range(rule.min, rule.max, 1);
                        row.title = title(key); row.value = value;
                        row.connect('notify::value', () => change(component, key, Math.round(row.value)));
                    } else if (rule.type === 'number') {
                        row = Adw.SpinRow.new_with_range(rule.min, rule.max, 0.01);
                        row.digits = 3; row.title = title(key); row.value = value;
                        row.connect('notify::value', () => change(component, key, row.value));
                    } else if (rule.type === 'boolean') {
                        row = new Adw.SwitchRow({title: title(key), active: value});
                        row.connect('notify::active', () => change(component, key, row.active));
                    } else if (rule.type === 'choice') {
                        row = new Adw.ComboRow({title: title(key), model: Gtk.StringList.new(rule.values)});
                        row.selected = Math.max(0, rule.values.indexOf(value));
                        row.connect('notify::selected', () => change(component, key, rule.values[row.selected]));
                    } else if (rule.type === 'color') {
                        row = new Adw.ActionRow({title: title(key)});
                        const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}),
                            valign: Gtk.Align.CENTER});
                        const rgba = new Gdk.RGBA(); rgba.parse(value); picker.rgba = rgba;
                        picker.connect('notify::rgba', () => {
                            const color = `#${[picker.rgba.red, picker.rgba.green, picker.rgba.blue]
                                .map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('')}`;
                            change(component, key, color);
                        });
                        row.add_suffix(picker);
                    } else {
                        row = new Adw.EntryRow({title: title(key), text: value, show_apply_button: true});
                        row.connect('apply', () => change(component, key, row.text));
                    }
                    group.add(row); rows[component].push(row);
                }
            }
        };
        const refresh = (id = selectedId) => {
            profiles = store.list();
            model.splice(0, model.get_n_items(), profiles.map(profile => profile.name));
            selectedId = profiles.some(profile => profile.id === id) ? id : profiles[0]?.id ?? '';
            chooser.selected = Math.max(0, profiles.findIndex(profile => profile.id === selectedId));
            name.text = selected()?.name ?? '';
            wallpaperRow.subtitle = selected()?.wallpaper ?? 'No wallpaper selected';
            renderEditors();
            if (!status.subtitle) status.subtitle = settings.get_string('status') || 'Select a theme to edit or apply';
        };
        chooser.connect('notify::selected', () => {
            const profile = profiles[chooser.selected];
            if (profile && selectedId !== profile.id) refresh(profile.id);
        });
        name.connect('apply', () => {
            const profile = selected();
            if (profile) save({...profile, name: name.text.trim()});
        });
        button('Apply theme', () => {
            if (selectedId) settings.set_string('requested-theme-id', selectedId);
        });
        button('New theme from current settings', () => {
            const id = `theme-${GLib.uuid_string_random().slice(0, 8)}`;
            save(captureSettings(id, 'New Theme', componentSettings));
        });
        button('Duplicate selected theme', () => {
            const profile = selected();
            if (profile) save({...profile, id: `theme-${GLib.uuid_string_random().slice(0, 8)}`,
                name: `${profile.name} Copy`});
        });
        button('Delete selected theme', () => {
            if (!selectedId || selectedId === settings.get_string('active-theme-id')) {
                status.subtitle = 'Switch to another theme before deleting this one'; return;
            }
            const dialog = new Adw.AlertDialog({heading: `Delete ${selected()?.name}?`, body: 'This cannot be undone.'});
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('delete', 'Delete');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.default_response = 'cancel'; dialog.close_response = 'cancel';
            dialog.choose(window, null, (source, result) => {
                if (source.choose_finish(result) !== 'delete') return;
                store.delete(selectedId); markRevision(); status.subtitle = 'Theme deleted'; refresh();
            });
        }, true);
        const wallpaper = new Adw.PreferencesGroup({title: 'Desktop wallpaper'});
        overview.add(wallpaper);
        const wallpaperRow = new Adw.ActionRow({title: 'Image'});
        wallpaper.add(wallpaperRow);
        const choose = new Gtk.Button({label: 'Choose image…', valign: Gtk.Align.CENTER});
        choose.connect('clicked', () => new Gtk.FileDialog({title: 'Choose theme wallpaper'}).open(window, null,
            (dialog, result) => {
                try {
                    const uri = dialog.open_finish(result).get_uri();
                    const profile = selected();
                    if (profile) { save({...profile, wallpaper: uri}); wallpaperRow.subtitle = uri; }
                } catch { /* File chooser cancelled. */ }
            }));
        wallpaperRow.add_suffix(choose);
        settings.connect('changed::status', () => { status.subtitle = settings.get_string('status') || 'Theme ready'; });
        refresh();
    }
}
