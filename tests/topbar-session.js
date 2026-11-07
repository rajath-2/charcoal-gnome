import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const rgb = color => [color.red, color.green, color.blue].join(',');

export default class TopbarTest extends Extension {
    enable() {
        this.run().catch(error => {
            console.error('TOPBAR FAIL', error.message, error.stack);
            global.context.terminate();
        });
    }

    async run() {
        await pause(1800);
        const topbar = Main.extensionManager.lookup('charcoal-topbar@local').stateObj;
        check(topbar?._prefs, 'topbar failed to enable');
        const prefs = topbar._prefs;
        prefs.set_string('mode', 'islands');
        prefs.set_string('text-color', '#ff6040');
        prefs.set_int('text-size', 120);
        prefs.set_boolean('bold-text', true);
        this.button = new St.BoxLayout({style_class: 'panel-button'});
        const nested = new St.BoxLayout();
        const label = new St.Label({text: 'Forced theme', style: 'color: #0000ff; font-weight: 300; font-size: 30px;'});
        const iconFile = Gio.File.new_for_path(`${GLib.getenv('XDG_CACHE_HOME')}/icon.svg`);
        iconFile.replace_contents(new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="blue"/></svg>'),
        null, false, Gio.FileCreateFlags.NONE, null);
        const icon = new St.Icon({gicon: new Gio.FileIcon({file: iconFile}), icon_size: 20});
        nested.add_child(label);
        nested.add_child(icon);
        this.button.add_child(nested);
        Main.panel._rightBox.insert_child_at_index(this.button, 0);
        await pause(500);
        check(rgb(label.get_theme_node().get_foreground_color()) === '255,96,64', 'nested inline color escaped theme');
        check(label.get_theme_node().get_font().get_weight() === 600, 'nested weight escaped theme');
        check(label.get_theme_node().get_font().get_size() === Main.panel.get_theme_node().get_font().get_size(),
            'nested font size escaped theme or compounded');
        const largeSize = label.get_theme_node().get_font().get_size();
        check(icon.get_effect('charcoal-foreground'), 'full-color icon has no tint');
        const dots = [];
        const visit = actor => {
            if (actor.has_style_class_name?.('workspace-dot')) dots.push(actor);
            actor.get_children().forEach(visit);
        };
        visit(Main.panel._leftBox);
        check(dots.length > 0, 'workspace dots missing');
        check(dots.every(dot => rgb(dot.get_theme_node().get_background_color()) === '255,96,64'), 'workspace dots escaped theme');
        label.set_style('color: #00ff00; padding-left: 7px;');
        label.set_style(`${label.get_style()} padding-right: 3px;`);
        const late = new St.Icon({icon_name: 'dialog-warning-symbolic', icon_size: 20});
        nested.add_child(late);
        await pause(200);
        check(rgb(label.get_theme_node().get_foreground_color()) === '255,96,64', 'extension restyle escaped theme');
        check(late.get_effect('charcoal-foreground'), 'late icon escaped theme');
        // A real screenshot exercises shader compilation and painting.
        const file = Gio.File.new_for_path(`${GLib.getenv('XDG_CACHE_HOME')}/topbar.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
        const geometry = Gio.File.new_for_path(`${GLib.getenv('XDG_CACHE_HOME')}/icon.json`);
        geometry.replace_contents(new TextEncoder().encode(JSON.stringify({position: icon.get_transformed_position(),
            size: icon.get_transformed_size()})), null, false, Gio.FileCreateFlags.NONE, null);
        prefs.set_string('text-color', '#40cc80');
        prefs.set_boolean('bold-text', false);
        prefs.set_int('text-size', 100);
        await pause(400);
        check(rgb(label.get_theme_node().get_foreground_color()) === '64,204,128', 'color preference did not update');
        check(label.get_theme_node().get_font().get_weight() === 400, 'weight preference did not update');
        check(label.get_theme_node().get_font().get_size() < largeSize, 'size preference did not update');
        nested.remove_child(late);
        check(!late.get_effect('charcoal-foreground'), 'removed icon retained tint');
        nested.add_child(late);
        check(late.get_effect('charcoal-foreground'), 'reparented icon lost tint');
        late.destroy();
        topbar.disable();
        check(label.get_style() === 'color: #00ff00; padding-left: 7px; padding-right: 3px;',
            'latest extension style was not restored');
        check(!icon.get_effect('charcoal-foreground'), 'disabled theme left icon tinted');
        this.button.destroy();
        this.button = null;
        // Re-enable to exercise repeated lifecycle and leave the manager consistent.
        topbar.enable();
        await pause(200);
        console.log('TOPBAR PASS');
        global.context.terminate();
    }

    disable() {
        this.button?.destroy();
        this.button = null;
    }
}
