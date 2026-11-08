// gjs -m tests/test_theme_client.js
import {ThemeClient} from '../shared/theme-client.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const local = {
    values: {'bar-color': '#112233', 'follow-theme': true, 'override-activations': '{}'},
    get_value(key) { return {deepUnpack: () => this.values[key], get_type_string: () => 's'}; },
    get_boolean(key) { return this.values[key]; },
    get_string(key) { return this.values[key]; },
    set_string(key, value) { this.values[key] = value; },
};
const central = {get_string(key) { return {'active-theme-id': 'night', 'activation-id': 'a', 'profile-revision': '1'}[key]; },
    connect() { return 1; }, disconnect() {}};
const profile = {version: 1, id: 'night', components: {topbar: {'bar-color': '#445566'}}};
const client = new ThemeClient('topbar', local, {themeSettings: central, loadProfile: () => profile,
    isEngineEnabled: () => true});
assert(client.get_string('bar-color') === '#445566', 'linked theme wins');
client.selectOverride('bar-color');
assert(client.get_string('bar-color') === '#112233', 'override wins');
client.useThemeValue('bar-color');
assert(client.get_string('bar-color') === '#445566', 'theme restored');
client.destroy();
const missing = new ThemeClient('topbar', local, {themeSettings: null});
assert(missing.get_string('bar-color') === '#112233', 'missing engine uses local');
missing.destroy();
print('theme client: ok');
