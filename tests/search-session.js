import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function waitFor(test, ms) {
    for (let waited = 0; waited < ms; waited += 100) {
        if (test()) return true;
        await pause(100);
    }
    return test();
}
const labels = box => box.get_children().filter(child => child instanceof St.Label);
const press = (search, key) => search._event({type: () => Clutter.EventType.KEY_PRESS, get_key_symbol: () => key});

export default class SearchTest extends Extension {
    enable() {
        this.run().catch(error => { console.error('SEARCH FAIL', error.message, error.stack); global.context.terminate(); });
    }

    async run() {
        let launchers;
        check(await waitFor(() => (launchers = Main.extensionManager.lookup('charcoal-launchers@local')?.stateObj)?._input, 8000),
            'launchers did not enable');
        await pause(1500); // let Blur My Shell finish starting
        const settings = launchers._settings;

        // Classic still opens through the shared hooks, with its full-screen backdrop.
        launchers._search.toggle();
        const classic = launchers._searches.classic;
        check(classic.isOpen && classic.backdrop?.width === global.stage.width, 'classic did not open with its backdrop');
        launchers._search.toggle();
        check(!classic.isOpen, 'classic did not close');

        settings.set_string('search-style', 'minimal');
        await pause(400); // settings changes reconfigure on idle and close any open search
        launchers._search.toggle();
        const search = launchers._searches.minimal;
        check(search.isOpen && !classic.isOpen, 'minimal did not open');
        check(global.stage.get_key_focus() === search.entry.clutter_text, 'entry lacks key focus');
        await pause(300);
        const monitor = Main.layoutManager.primaryMonitor;
        check(!search.actor.style, `minimal dims the screen: ${search.actor.style}`);
        check(search.actor.get_children().every(child => child.width < global.stage.width),
            'minimal has a full-screen child');
        const [, y] = search.panel.get_transformed_position();
        check(y < monitor.y + monitor.height / 4, `panel too low: ${y}`);
        check(!search.scroll.visible, 'results shown for an empty query');
        const bms = Main.extensionManager.lookup('blur-my-shell@aunetx')?.stateObj;
        check(!bms?._effects_manager || search.blur.get_first_child()?.name === 'charcoal-static-blur', 'bar blur not attached');
        check(search.blur.width === search.panel.width && search.blur.height === search.panel.height, 'blur does not match the bar');

        search.entry.set_text('zzzznotanapp');
        check(await waitFor(() => labels(search.resultBox).some(l => l.text === 'No results'), 5000), 'no "No results" row');
        await pause(600);
        const empty = labels(search.resultBox);
        check(search.rows.length === 0 && empty.length === 1 && empty[0].text === 'No results',
            `expected one No results row: ${empty.map(l => l.text)} rows=${search.rows.length}`);

        search.entry.set_text('settings');
        check(await waitFor(() => search.rows.length > 0 && !search.stale, 5000), 'no rows for "settings"');
        await pause(600);
        check(!search.resultBox.get_children().some(child => child.style_class?.includes('charcoal-heading')),
            'minimal shows headings');

        let activated = false;
        for (const {result} of search.rows) result.activate = () => { activated = true; };
        search._schedule();
        press(search, Clutter.KEY_Return);
        check(!activated && search.isOpen, 'Enter activated a stale row');
        check(search.rows.every(({row}) => row.opacity < 255), 'stale rows not dimmed');
        check(await waitFor(() => !search.stale, 3000), 'rows stayed stale');

        launchers._search.toggle();
        check(!search.isOpen, 'minimal did not close');
        console.log('SEARCH PASS', bms?._effects_manager ? 'with blur' : 'without Blur My Shell');
        global.context.terminate();
    }
}
