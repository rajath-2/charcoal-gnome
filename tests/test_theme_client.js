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
const position = {values: {'positions': '{}', 'follow-theme': true, 'override-activations': '{}'},
    get_value(key) { return {deepUnpack: () => this.values[key], get_type_string: () => 's'}; },
    get_boolean(key) { return this.values[key]; }, get_string(key) { return this.values[key]; },
    set_string(key, value) { this.values[key] = value; return true; }};
const placement = new ThemeClient('widgets', position, {themeSettings: central,
    loadProfile: () => ({version: 1, id: 'night', components: {widgets: {positions: '{"music":{"x":0.2}}'}}}),
    isEngineEnabled: () => true});
placement.set_string('positions', '{"music":{"x":0.8}}');
assert(placement.get_string('positions') === '{"music":{"x":0.8}}', 'dragged position becomes active override');
assert(JSON.parse(position.values['override-activations']).positions === 'a', 'override records current activation');
placement.destroy();
print('theme client: ok');
