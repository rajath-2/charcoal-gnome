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
        await pause(600); // fade-in plus grow
        const monitor = Main.layoutManager.primaryMonitor;
        check(!search.actor.style, `minimal dims the screen: ${search.actor.style}`);
        check(search.actor.get_children().every(child => child.width < global.stage.width),
            'minimal has a full-screen child');
        const [, y] = search.panel.get_transformed_position();
        check(Math.abs(y + search.panel.height / 2 - (monitor.y + monitor.height / 2)) <= 1, `bar not vertically centred: ${y}`);
        check(!search.scroll.visible, 'results shown for an empty query');
        const bms = Main.extensionManager.lookup('blur-my-shell@aunetx')?.stateObj;
        check(!bms?._effects_manager || search.blur.get_first_child()?.name === 'charcoal-static-blur', 'bar blur not attached');
        check(search.blur.width === search.panel.width && search.blur.height === search.panel.height, `blur does not match the bar: ${search.blur.width}x${search.blur.height} vs ${search.panel.width}x${search.panel.height}`);

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
        check(search.rows.every(({row}) => row.opacity < 255 && !row.track_hover), 'stale rows not dimmed or still hoverable');
        check(await waitFor(() => !search.stale, 3000), 'rows stayed stale');

        search.entry.set_text('');
        search._query();
        check(search.groups.size === 0 && await waitFor(() => search.rows.length === 0, 3000), 'minimal empty query built result groups');

        launchers._search.toggle();
        check(!search.isOpen, 'minimal did not close');

        // search-bar-position moves the bare bar: 20 puts its centre a fifth of the way down.
        settings.set_int('search-bar-position', 20);
        await pause(400);
        launchers._search.toggle();
        await pause(600);
        const [, placed] = search.panel.get_transformed_position();
        check(Math.abs(placed + search.panel.height / 2 - (monitor.y + monitor.height * 0.2)) <= 1, `bar not at 20%: ${placed}`);
        launchers._search.toggle();
        settings.set_int('search-bar-position', 50);

        // Opening animation: a circle grows out, then the bar grows sideways out of it, centred.
        console.log('SEARCH enable_animations', St.Settings.get().enable_animations);
        settings.set_int('open-duration', 300);
        settings.set_int('search-max-height', 90); // so the pixel cap, not the percentage, limits the card
        await pause(400);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const full = Math.min(settings.get_int('launcher-width') * scale, monitor.width - 40);
        const centred = () => Math.abs(search.panel.x + search.panel.width / 2 - (monitor.x + monitor.width / 2)) < 1;
        launchers._search.toggle();
        check(search.isOpen && search.panel.width < full && search.panel.scale_x < 1 && search.panel.opacity === 255
            && search.entry.clutter_text.opacity === 0,
            `bar did not start as a growing circle: width=${search.panel.width} scale=${search.panel.scale_x} opacity=${search.panel.opacity}`);
        check(centred(), 'circle not centred');
        // Typed during the animation, through the real input path.
        const keyboard = global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        for (const ch of 'sett') {
            const keyval = Clutter.unicode_to_keysym(ch.charCodeAt(0));
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        }
        await pause(200);
        check(search.panel.width > 0 && search.panel.width < full && centred(), `bar not growing: width=${search.panel.width}`);
        check(search.blur.x === Math.round(search.panel.x) && search.blur.width === Math.round(search.panel.width),
            `blur does not follow the growing bar: ${search.blur.x},${search.blur.width} vs ${search.panel.x},${search.panel.width}`);
        await pause(600);
        check(search.entry.get_text() === 'sett', `typing lost during the animation: "${search.entry.get_text()}"`);
        check(search.panel.width === full && search.panel.scale_x === 1 && search.blur.scale_x === 1
            && search.entry.clutter_text.opacity === 255, `bar did not finish: width=${search.panel.width}/${full}`);

        // Several renders in one main-loop pass rebuild the card once.
        let rebuilds = 0;
        const rebuild = search._rebuild;
        search._rebuild = function () { rebuilds++; return rebuild.call(this); };
        search._render(); search._render(); search._render();
        await pause(200);
        search._rebuild = rebuild;
        check(rebuilds === 1, `renders not batched: ${rebuilds} rebuilds`);

        // The card's height is capped in pixels as well as by search-max-height.
        check(await waitFor(() => search.rows.length > 0 && !search.stale, 5000), 'no rows for "sett"');
        await pause(600);
        search.resultBox.add_child(new St.Widget({height: 2000}));
        search._place();
        await pause(400);
        check(search.scroll.height === monitor.height - 240 * scale, `card not capped: ${search.scroll.height}`);

        // Clearing the query eases the card back down to the bar.
        search.entry.set_text('');
        let eased = false;
        for (let i = 0; i < 60 && search.scroll.visible; i++) {
            eased ||= !!search.scroll.get_transition('height');
            await pause(10);
        }
        check(eased && !search.scroll.visible, `card did not ease shut: eased=${eased} visible=${search.scroll.visible}`);
        check(search.blur.height === search.panel.height, 'blur does not match the collapsed bar');

        // Closing animates, then destroys the actor.
        launchers._search.toggle();
        check(!search.isOpen && search.closing.size === 1, 'close did not animate');
        check(await waitFor(() => search.closing.size === 0, 1000), 'closing actor not destroyed');

        // Animations off: the full bar appears at once.
        settings.set_boolean('animations', false);
        await pause(400);
        launchers._search.toggle();
        check(search.panel.width === full && search.panel.opacity === 255 && search.entry.clutter_text.opacity === 255,
            `animations off but bar not final: width=${search.panel.width} opacity=${search.panel.opacity}`);
        launchers._search.toggle();
        check(search.closing.size === 0, 'animations off but close animated');

        // Live blur: Blur My Shell's pipeline sits inside the masked layer, so the mask cuts its output.
        settings.set_boolean('static-blur', false);
        await pause(400);
        launchers._search.toggle();
        await pause(800);
        check(!bms?._effects_manager || search.blur.get_children().some(child => child.name === 'charcoal-search-backdrop'),
            'live blur not attached');
        check(!search.blur.get_n_children() ? !search.mask : search.blur.get_effects().includes(search.mask) && search.blur.width === search.panel.width, `live blur not masked n=${search.blur.get_n_children()} mask=${!!search.mask} w=${search.blur.width}/${search.panel.width}`);
        launchers._search.toggle();
        console.log('SEARCH PASS', bms?._effects_manager ? 'with blur' : 'without Blur My Shell');
        global.context.terminate();
    }
}
