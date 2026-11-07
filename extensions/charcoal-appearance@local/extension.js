import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {TARGETS} from './targets.js';

export default class CharcoalAppearance extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._desktop = new Map(TARGETS.map(([key, schema]) => [key, new Gio.Settings({schema_id: schema})]));
        // Keep the first snapshot: after a crash, the live values are already ours.
        if (!Object.keys(this._settings.get_value('saved').deepUnpack()).length) {
            const saved = {};
            for (const [key, desktop] of this._desktop)
                saved[key] = desktop.get_value(key).print(false);
            this._settings.set_value('saved', new GLib.Variant('a{ss}', saved));
        }
        this._changed = this._settings.connect('changed', (_, key) => this._apply(key));
        for (const [key] of TARGETS)
            this._apply(key);
    }

    _apply(key) {
        const desktop = this._desktop.get(key);
        const value = this._settings.get_value(key);
        if (desktop && !desktop.get_value(key).equal(value))
            desktop.set_value(key, value);
    }

    disable() {
        this._settings.disconnect(this._changed);
        const saved = this._settings.get_value('saved').deepUnpack();
        for (const [key, text] of Object.entries(saved)) {
            try {
                this._desktop.get(key)?.set_value(key, GLib.Variant.parse(null, text, null, null));
            } catch (error) {
                console.warn(`Charcoal Appearance: could not restore ${key}: ${error.message}`);
            }
        }
        this._settings.reset('saved');
        this._settings = null;
        this._desktop = null;
    }
}
