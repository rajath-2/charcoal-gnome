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
const profile = {version: 1, id: 'night', name: 'Night', wallpaper: null,
    components: {topbar: {'bar-color': '#445566'}}};
const client = new ThemeClient('topbar', local, {themeSettings: central, loadProfile: () => profile,
    isEngineEnabled: () => true});
assert(client.get_string('bar-color') === '#445566', 'linked theme wins');
client.selectOverride('bar-color');
assert(client.get_string('bar-color') === '#112233', 'override wins');
client.useThemeValue('bar-color');
assert(client.get_string('bar-color') === '#445566', 'theme restored');
assert(Object.hasOwn(JSON.parse(local.values['override-activations']), 'bar-color'),
    'saved override remains available after choosing theme value');
client.destroy();
let shellChanged;
let enabled = true;
const toggle = new ThemeClient('topbar', local, {themeSettings: central, loadProfile: () => profile,
    isEngineEnabled: () => enabled, shellSettings: {
        connect(_signal, callback) { shellChanged = callback; return 1; }, disconnect() {},
    }});
let changes = 0;
toggle.connectChanged(() => changes++);
enabled = false; shellChanged();
assert(changes === 1 && toggle.get_string('bar-color') === '#112233', 'engine disable redraws with local value');
enabled = true; shellChanged();
assert(changes === 2 && toggle.get_string('bar-color') === '#445566', 'engine re-enable redraws with theme value');
toggle.destroy();
for (const bad of [
    {...profile, components: {topbar: {...profile.components.topbar, 'search-enabled': true}}},
    {...profile, components: {topbar: {'bar-height': 900}}},
]) {
    const invalid = new ThemeClient('topbar', local, {themeSettings: central, loadProfile: () => bad,
        isEngineEnabled: () => true});
    assert(invalid.get_string('bar-color') === '#112233', 'invalid profile falls back to local settings');
    invalid.destroy();
}
const missing = new ThemeClient('topbar', local, {themeSettings: null});
assert(missing.get_string('bar-color') === '#112233', 'missing engine uses local');
missing.destroy();
const position = {values: {'positions': '{}', 'follow-theme': true, 'override-activations': '{}'},
    get_value(key) { return {deepUnpack: () => this.values[key], get_type_string: () => 's'}; },
    get_boolean(key) { return this.values[key]; }, get_string(key) { return this.values[key]; },
    set_string(key, value) { this.values[key] = value; return true; }};
const placement = new ThemeClient('widgets', position, {themeSettings: central,
    loadProfile: () => ({version: 1, id: 'night', name: 'Night', wallpaper: null,
        components: {widgets: {positions: '{"music":{"x":0.2}}'}}}),
    isEngineEnabled: () => true});
placement.set_string('positions', '{"music":{"x":0.8}}');
assert(placement.get_string('positions') === '{"music":{"x":0.8}}', 'dragged position becomes active override');
assert(JSON.parse(position.values['override-activations']).positions === 'a', 'override records current activation');
placement.destroy();
const appearance = {values: {'icon-theme': 'GreyStone - circle', 'follow-theme': true,
    'override-activations': '{}'}, get_value(key) { return {
    deepUnpack: () => this.values[key], get_type_string: () => 's'}; },
    get_boolean(key) { return this.values[key]; }, get_string(key) { return this.values[key]; }};
const icons = new ThemeClient('appearance', appearance, {themeSettings: central,
    loadProfile: () => ({version: 1, id: 'night', name: 'Night', wallpaper: null,
        components: {appearance: {'icon-theme': 'Other icons'}}}),
    isEngineEnabled: () => true});
assert(icons.get_value('icon-theme').deepUnpack() === 'Other icons', 'linked icon choice reaches desktop writer');
icons.destroy();
print('theme client: ok');
