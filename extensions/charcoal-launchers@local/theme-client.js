import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {resolveValue} from './theme-policy.js';
import {validateProfile} from './theme-profile.js';

const ENGINE_UUID = 'charcoal-themes@local';
const ENGINE_SCHEMA = 'org.gnome.shell.extensions.charcoal-themes';

function openEngineSettings() {
    try {
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', ENGINE_UUID, 'schemas']);
        const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
        return new Gio.Settings({settings_schema: source.lookup(ENGINE_SCHEMA, true)});
    } catch { return null; }
}

function loadProfile(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
    try {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'charcoal', 'themes', `${id}.json`]);
        const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
        const profile = JSON.parse(new TextDecoder().decode(bytes));
        return profile?.id === id ? validateProfile(profile).profile : null;
    } catch { return null; }
}

function engineEnabled(shellSettings) {
    try { return !!shellSettings?.get_strv('enabled-extensions').includes(ENGINE_UUID); }
    catch { return false; }
}

export class ThemeClient {
    constructor(component, localSettings, options = {}) {
        this.component = component;
        this.local = localSettings;
        this.central = options.themeSettings === undefined ? openEngineSettings() : options.themeSettings;
        this._loadProfile = options.loadProfile ?? loadProfile;
        this._callbacks = new Set();
        this._shellSettings = options.shellSettings === undefined
            ? new Gio.Settings({schema_id: 'org.gnome.shell'}) : options.shellSettings;
        this._isEngineEnabled = options.isEngineEnabled ?? (() => engineEnabled(this._shellSettings));
        this._revision = null;
        this._profile = null;
        this._state = this._themeState();
        this._shellSignal = this._shellSettings?.connect('changed::enabled-extensions', () => this._notify());
        this._centralSignal = this.central?.connect('changed', () => this._notify());
    }

    // Only a real theme switch, edit or engine toggle redraws consumers; status and request keys do not.
    _themeState() {
        const enabled = !!this.central && this._isEngineEnabled();
        return [enabled, ...['active-theme-id', 'profile-revision', 'activation-id']
            .map(key => this.central?.get_string(key) ?? '')].join('\n');
    }

    _notify() {
        const state = this._themeState();
        if (state === this._state) return;
        this._state = state;
        this._revision = null;
        for (const callback of this._callbacks) callback();
    }

    _activeProfile() {
        if (!this.central || !this._isEngineEnabled() || !this.local.get_boolean('follow-theme')) return null;
        const id = this.central.get_string('active-theme-id');
        const revision = this.central.get_string('profile-revision');
        if (!id) return null;
        if (this._revision !== `${id}:${revision}`) {
            this._revision = `${id}:${revision}`;
            const profile = this._loadProfile(id);
            this._profile = profile?.id === id ? validateProfile(profile).profile : null;
        }
        return this._profile;
    }

    _overrides() {
        try {
            const value = JSON.parse(this.local.get_string('override-activations'));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch { return {}; }
    }

    get(key) {
        const original = this.local.get_value(key);
        const local = original.deepUnpack();
        const profile = this._activeProfile();
        const theme = profile?.components?.[this.component]?.[key];
        if (theme !== undefined && this.local.settings_schema?.has_key?.(key)) {
            try {
                const variant = new GLib.Variant(original.get_type_string(), theme);
                if (!this.local.settings_schema.get_key(key).range_check(variant)) return local;
            } catch { return local; }
        }
        return resolveValue({key, local, theme, linked: !!profile,
            overrideActivation: this._overrides(), activationId: this.central?.get_string('activation-id')});
    }

    get_value(key) {
        const original = this.local.get_value(key);
        const value = this.get(key);
        return value === original.deepUnpack() ? original : new GLib.Variant(original.get_type_string(), value);
    }

    get_string(key) { return this.get(key); }
    get_int(key) { return this.get(key); }
    get_boolean(key) { return this.get(key); }
    get_strv(key) { return this.get(key); }
    get_double(key) { return this.get(key); }
    get settings_schema() { return this.local.settings_schema; }

    connect(signal, callback) { return this.local.connect(signal, callback); }
    disconnect(id) { this.local.disconnect(id); }

    set_string(key, value) {
        if (this._activeProfile()?.components?.[this.component]?.[key] !== undefined) this.selectOverride(key);
        return this.local.set_string(key, value);
    }

    selectOverride(key) {
        if (!this.central) return;
        const value = {...this._overrides(), [key]: this.central.get_string('activation-id')};
        this.local.set_string('override-activations', JSON.stringify(value));
    }

    useThemeValue(key) {
        const value = this._overrides();
        if (Object.hasOwn(value, key)) value[key] = '';
        this.local.set_string('override-activations', JSON.stringify(value));
    }

    connectChanged(callback) {
        this._callbacks.add(callback);
        return () => this._callbacks.delete(callback);
    }

    destroy() {
        if (this._centralSignal) this.central.disconnect(this._centralSignal);
        if (this._shellSignal) this._shellSettings.disconnect(this._shellSignal);
        this._callbacks.clear();
        this.central = null;
        this._shellSettings = null;
        this.local = null;
    }
}
