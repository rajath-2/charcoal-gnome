import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {geocodeUrl, mergePlaces, parseGeocode, parsePlaceSearch, placeSearchUrl} from './policy.js';
import {attachThemeControls} from './theme-controls.js';

const LOOK_KEYS = ['background-color', 'background-opacity', 'border-color', 'border-width', 'border-opacity',
    'shadow-color', 'shadow-size', 'shadow-opacity', 'corner-radius', 'accent-color', 'text-color', 'blur', 'static-blur'];

export default class CharcoalWidgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 760);
        window.search_enabled = true;
        const signals = [];
        const watch = (key, callback) => signals.push(settings.connect(`changed::${key}`, callback));
        const session = new Soup.Session({user_agent: 'Charcoal Widgets', timeout: 20});
        const cancellable = new Gio.Cancellable();
        window.connect('close-request', () => {
            signals.forEach(id => settings.disconnect(id));
            cancellable.cancel();
            return false;
        });
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
        const color = (g, key, title) => {
            const row = new Adw.ActionRow({title});
            const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
            const update = () => { const rgba = new Gdk.RGBA(); rgba.parse(settings.get_string(key)); picker.rgba = rgba; };
            update(); watch(key, update);
            picker.connect('notify::rgba', () => {
                const c = picker.rgba;
                const hex = `#${[c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
                if (settings.get_string(key) !== hex) settings.set_string(key, hex);
            });
            row.add_suffix(picker); g.add(row);
        };
        const button = (g, title, subtitle, label, callback, css = []) => {
            const row = new Adw.ActionRow({title, subtitle});
            const b = new Gtk.Button({label, valign: Gtk.Align.CENTER, css_classes: css});
            b.connect('clicked', callback);
            row.add_suffix(b); g.add(row); return row;
        };

        const widgets = page('Widgets', 'view-grid-symbolic');
        attachThemeControls(window, widgets, settings, 'widgets');
        const shown = group(widgets, 'Widgets', 'Shown on the desktop while no window is open on that screen.');
        toggle(shown, 'weather-enabled', 'Weather');
        toggle(shown, 'calendar-enabled', 'Calendar', 'Events come from the calendars in your top bar’s date menu');
        toggle(shown, 'music-enabled', 'Music');
        const sizes = group(widgets, 'Text and icon size', 'Text, icons, artwork and spacing. Drag a card’s edge or corner to resize it: its layout adapts automatically to the available space. Larger text leaves room for fewer details.');
        spin(sizes, 'weather-size', 'Weather', 70, 150, 5);
        spin(sizes, 'calendar-size', 'Calendar', 70, 150, 5);
        spin(sizes, 'music-size', 'Music', 70, 150, 5);
        const placement = group(widgets, 'Placement', 'Drag a widget by its background to move it, by its edge or corner to resize it to any shape.');
        toggle(placement, 'locked', 'Lock widgets', 'Stop widgets from being moved or resized');
        button(placement, 'Reset positions', 'Weather top-left, calendar top-right, music bottom-center', 'Reset',
            () => settings.reset('positions'));
        button(placement, 'Reset shapes', 'Each widget fits its content again', 'Reset', () => settings.reset('sizes'));

        const weather = group(widgets, 'Weather');
        const describeCity = () => {
            const city = settings.get_string('weather-city');
            weather.description = city ? `Showing weather for ${city}` : 'Search for your city to show the weather';
        };
        describeCity(); watch('weather-city', describeCity);
        const entry = new Adw.EntryRow({title: 'City', show_apply_button: true});
        weather.add(entry);
        let results = [];
        const clearResults = () => { results.forEach(row => weather.remove(row)); results = []; };
        const message = text => {
            const row = new Adw.ActionRow({title: text}); weather.add(row); results.push(row);
        };
        // Resolves to the parsed JSON, null on any failure, or undefined when cancelled.
        const fetchJson = url => new Promise(resolve => {
            const request = Soup.Message.new('GET', url);
            session.send_and_read_async(request, GLib.PRIORITY_DEFAULT, cancellable, (_, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    resolve(request.get_status() === Soup.Status.OK ? JSON.parse(new TextDecoder().decode(bytes.get_data())) : null);
                } catch (error) {
                    resolve(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? undefined : null);
                }
            });
        });
        let searchId = 0;
        const search = async () => {
            const name = entry.text.trim();
            const id = ++searchId;
            clearResults();
            if (!name) return;
            message('Searching…');
            const [osm, meteo] = await Promise.all([fetchJson(placeSearchUrl(name)), fetchJson(geocodeUrl(name))]);
            if (osm === undefined || meteo === undefined || id !== searchId) return;
            clearResults();
            if (osm === null && meteo === null) { message('Couldn’t reach the weather service'); return; }
            const places = mergePlaces(parsePlaceSearch(osm), parseGeocode(meteo));
            if (!places.length) { message('No matching places'); return; }
            for (const place of places) {
                const row = new Adw.ActionRow({title: place.label, activatable: true, use_markup: false,
                    subtitle: `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`});
                row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
                row.connect('activated', () => {
                    // The widget refetches when the city changes, so write it last.
                    settings.set_double('weather-latitude', place.latitude);
                    settings.set_double('weather-longitude', place.longitude);
                    settings.set_string('weather-city', place.label);
                    entry.text = '';
                    clearResults();
                });
                weather.add(row); results.push(row);
            }
        };
        entry.connect('apply', search);
        entry.connect('entry-activated', search);

        const music = group(widgets, 'Music');
        const artwork = button(music, 'Artwork when nothing is playing', '', 'Choose…', () => {
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_mime_type('image/*');
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            new Gtk.FileDialog({title: 'Choose artwork', filters, default_filter: filter}).open(window, null, (dialog, result) => {
                try {
                    const path = dialog.open_finish(result)?.get_path();
                    if (path) settings.set_string('idle-artwork', path);
                } catch {}
            });
        });
        const reset = new Gtk.Button({label: 'Default', valign: Gtk.Align.CENTER});
        reset.connect('clicked', () => settings.reset('idle-artwork'));
        artwork.add_suffix(reset);
        const describeArt = () => {
            const path = settings.get_string('idle-artwork');
            artwork.subtitle = path ? GLib.path_get_basename(path) : 'Built-in artwork';
            reset.sensitive = !!path;
        };
        describeArt(); watch('idle-artwork', describeArt);

        const look = page('Appearance', 'applications-graphics-symbolic');
        const background = group(look, 'Background');
        color(background, 'background-color', 'Color');
        spin(background, 'background-opacity', 'Opacity', 0, 100, 5, 'Percent');
        const border = group(look, 'Border');
        color(border, 'border-color', 'Color');
        spin(border, 'border-width', 'Width', 0, 6, 1, 'Pixels; 0 hides the border');
        spin(border, 'border-opacity', 'Opacity', 0, 100, 5, 'Percent');
        const shadow = group(look, 'Shadow and glow', 'A shadow in the border color reads as a glow.');
        color(shadow, 'shadow-color', 'Color');
        spin(shadow, 'shadow-size', 'Size', 0, 60, 1, 'Pixels; 0 hides it');
        spin(shadow, 'shadow-opacity', 'Opacity', 0, 100, 5, 'Percent');
        const shape = group(look, 'Shape and text');
        spin(shape, 'corner-radius', 'Corner radius', 0, 40, 1);
        color(shape, 'accent-color', 'Accent');
        color(shape, 'text-color', 'Text');
        const blur = group(look, 'Blur');
        toggle(blur, 'blur', 'Background blur', 'Uses your Blur My Shell popup pipeline');
        toggle(blur, 'static-blur', 'Static blur', 'Wallpaper-only blur; cheaper than live blur');
        const defaults = group(look, 'Defaults');
        button(defaults, 'Restore reference look', 'Dark glass with an amber border and glow', 'Restore',
            () => LOOK_KEYS.forEach(key => settings.reset(key)));
    }
}
