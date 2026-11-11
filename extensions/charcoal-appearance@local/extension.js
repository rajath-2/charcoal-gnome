import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {TARGETS} from './targets.js';
import {THEME, updateIcons} from './update.js';
import {ThemeClient} from './theme-client.js';

const DAY = 24 * 60 * 60;

export default class CharcoalAppearance extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._applied = new Map();
        this._checking = false;
        this._theme = new ThemeClient('appearance', this._settings);
        this._unwatchTheme = this._theme.connectChanged(() => {
            for (const [key] of TARGETS) this._apply(key);
        });
        this._desktop = new Map(TARGETS.map(([key, schema]) => [key, new Gio.Settings({schema_id: schema})]));
        // Keep the first snapshot: after a crash, the live values are already ours.
        if (!Object.keys(this._settings.get_value('saved').deepUnpack()).length) {
            const saved = {};
            for (const [key, desktop] of this._desktop)
                saved[key] = desktop.get_value(key).print(false);
            this._settings.set_value('saved', new GLib.Variant('a{ss}', saved));
        }
        this._changed = this._settings.connect('changed', (_, key) => {
            if (key === 'follow-theme' || key === 'override-activations') {
                for (const [target] of TARGETS) this._apply(target);
            } else this._apply(key);
        });
        for (const [key] of TARGETS)
            this._apply(key);
        // Check soon after login, then hourly; each check is skipped unless a day has passed.
        this._cancellable = new Gio.Cancellable();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._checkIcons();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._timer, '[charcoal-appearance] icon updates');
    }

    async _checkIcons() {
        const settings = this._settings;
        const cancellable = this._cancellable;
        const now = Math.floor(Date.now() / 1000);
        if (this._checking || !settings.get_boolean('icon-updates') || now - settings.get_int64('icon-last-check') < DAY)
            return;
        this._checking = true;
        try {
            const version = await updateIcons(cancellable);
            if (cancellable.is_cancelled()) return;
            settings.set_int64('icon-last-check', now);
            if (version)
                Main.notify('Charcoal Appearance', `${THEME} icons updated to version ${version}`);
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Charcoal Appearance: icon update failed: ${error.message}`);
        } finally {
            if (this._cancellable === cancellable) this._checking = false;
        }
    }

    _apply(key) {
        const desktop = this._desktop.get(key);
        if (!desktop) return;
        const value = this._theme.get_value(key);
        this._applied.set(key, value);
        if (desktop && !desktop.get_value(key).equal(value))
            desktop.set_value(key, value);
    }

    disable() {
        this._unwatchTheme?.();
        this._unwatchTheme = null;
        GLib.Source.remove(this._timer);
        this._cancellable.cancel();
        this._settings.disconnect(this._changed);
        const saved = this._settings.get_value('saved').deepUnpack();
        for (const [key, text] of Object.entries(saved)) {
            try {
                const desktop = this._desktop.get(key);
                // Preserve desktop changes made outside Charcoal since our last write.
                if (desktop && this._applied.get(key)?.equal(desktop.get_value(key)))
                    desktop.set_value(key, GLib.Variant.parse(null, text, null, null));
            } catch (error) {
                console.warn(`Charcoal Appearance: could not restore ${key}: ${error.message}`);
            }
        }
        this._settings.reset('saved');
        this._theme?.destroy();
        this._theme = null;
        this._settings = null;
        this._desktop = null;
        this._applied = null;
    }
}
