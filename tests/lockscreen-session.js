import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {findLockActors, snapshotActors, restoreActors} from '../charcoal-lockscreen@local/actors.js';

const UUID = 'charcoal-lockscreen@local';
let started = false;
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
const rect = actor => {
    const [x, y] = actor.get_transformed_position(), [width, height] = actor.get_transformed_size();
    return {x, y, width, height};
};

async function waitFor(test, ms) {
    for (let waited = 0; waited < ms; waited += 100) {
        if (test()) return true;
        await pause(100);
    }
    return test();
}

export default class LockTest extends Extension {
    // GNOME disables this fixture while locked and re-enables it on unlock: run the checks once.
    enable() { if (started) return; started = true; this.run().catch(error => { console.error('LOCKSCREEN FAIL', error.message, error.stack); global.context.terminate(); }); }

    async lock() {
        Main.screenShield.lock(false);
        await pause(1000);
        const actors = findLockActors();
        check(actors?.clock && actors.prompt, 'GNOME lock actors unavailable');
        return actors;
    }

    async unlock() {
        Main.screenShield.deactivate(false);
        check(await waitFor(() => !Main.screenShield.locked && !Main.screenShield._dialog, 5000), 'unlock did not finish');
    }

    checkStyled(actors, label) {
        check(actors.clock.style?.includes('color: #abcdef') && actors.clock.style.includes('font-size: 40px'),
            `${label}: clock not styled: ${actors.clock.style} state=${Main.extensionManager.lookup(UUID).state} dialog=${!!Main.extensionManager.lookup(UUID).stateObj._dialog} status=${Main.extensionManager.lookup(UUID).stateObj._settings?.get_string('status')}`);
        check(actors.date.style?.includes('font-size: 40px'), `${label}: date not styled: ${actors.date.style}`);
    }

    async checkTheme(runtime, settings) {
        check(runtime._source?.component === 'lockscreen', 'runtime does not read through ThemeClient');
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'charcoal-themes@local', 'schemas']);
        const schemas = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
        const engine = new Gio.Settings({settings_schema: schemas.lookup('org.gnome.shell.extensions.charcoal-themes', true)});
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const before = shell.get_strv('enabled-extensions');
        const monitor = Main.layoutManager.primaryMonitor;
        const clockAt = async (y, label) => {
            await pause(300);
            const clock = rect(findLockActors().clock);
            check(near(clock.y, monitor.y + y * monitor.height + (0.15 * monitor.height - clock.height) / 2),
                `${label}: clock ${JSON.stringify(clock)} not at ${y}; source ${runtime._source.get_double('clock-y')} placement ${JSON.stringify(runtime._placements?.clock)}`);
        };
        engine.set_string('active-theme-id', 'night');
        engine.set_string('activation-id', 'one');
        shell.set_strv('enabled-extensions', [...before, 'charcoal-themes@local']);
        settings.set_boolean('follow-theme', true);
        await clockAt(0.4, 'themed');
        settings.set_double('clock-y', 0.1);
        runtime._source.selectOverride('clock-y');
        await clockAt(0.1, 'local override');
        engine.set_string('activation-id', 'two');
        await clockAt(0.4, 'override dormant after switch');
        runtime._source.selectOverride('clock-y');
        await clockAt(0.1, 'override restored');
        // Leave the engine off so it does not start on unlock.
        shell.set_strv('enabled-extensions', before);
        await clockAt(0.1, 'engine disabled uses local');
        settings.set_boolean('follow-theme', false);
        settings.set_double('clock-y', 0.05);
        await clockAt(0.05, 'unlinked');
    }

    async run() {
        await pause(1500);
        // Enabled the user's way (not via the session mode) so it stays enabled on the lock screen.
        Main.extensionManager.enableExtension(UUID);
        await pause(300);
        const theme = Main.extensionManager.lookup(UUID);
        check(theme?.stateObj, `${UUID} not loaded: ${theme?.error}`);
        const settings = theme.stateObj.getSettings();
        check(theme.state === 1, `${UUID} not active: ${theme.state}`);
        settings.set_string('text-color', '#abcdef');
        settings.set_int('font-size', 40);
        settings.set_double('prompt-x', 0.05);
        settings.set_double('prompt-y', 0.6);
        settings.set_double('clock-x', 0.05);
        settings.set_double('clock-y', 0.05);
        settings.set_string('text-content', 'x'.repeat(500));
        settings.set_boolean('text-visible', true);
        settings.set_string('image-uri', '/nonexistent/charcoal.png');
        settings.set_boolean('image-visible', true);
        settings.set_string('lock-wallpaper', 'file:///nonexistent/wall.png');

        // Lock 1: styling and placement applied at lock.
        let actors = await this.lock();
        this.checkStyled(actors, 'lock 1');
        const monitor = Main.layoutManager.primaryMonitor;
        const clock = rect(actors.clock);
        check(near(clock.y, monitor.y + 0.05 * monitor.height + (0.15 * monitor.height - clock.height) / 2),
            `clock not placed: ${JSON.stringify(clock)}`);
        const text = actors.dialog.get_children().find(a => a.name === 'charcoal-lock-text');
        check(text && text.text.length === 200, `text block not capped: ${text?.text.length}`);
        check(!actors.dialog.get_children().some(a => a.name === 'charcoal-lock-image' || a.name === 'charcoal-lock-wallpaper'),
            'invalid image or wallpaper was shown');
        settings.set_string('image-uri', `${this.path}/image.svg`);
        settings.set_string('lock-wallpaper', `file://${this.path}/image.svg`);
        await pause(200);
        const named = name => actors.dialog.get_children().some(a => a.name === name);
        check(named('charcoal-lock-image') && named('charcoal-lock-wallpaper'), 'valid image or wallpaper not shown');
        // A wallpaper file that goes missing keeps the previous background and reports it.
        settings.set_string('lock-wallpaper', '/nonexistent/gone.png');
        await pause(200);
        check(named('charcoal-lock-wallpaper'), 'missing wallpaper dropped the previous background');
        check(settings.get_string('status').includes('gone.png'), `missing wallpaper not reported: ${settings.get_string('status')}`);
        settings.set_string('lock-wallpaper', `file://${this.path}/image.svg`);
        await pause(200);
        check(settings.get_string('status') === '', `status not cleared: ${settings.get_string('status')}`);

        // Prompt moves within safe bounds once GNOME shows it.
        actors.dialog.activate();
        await pause(1200);
        actors = findLockActors();
        check(actors?.authEntry?.visible, 'GNOME authentication entry unavailable');
        const prompt = rect(actors.prompt);
        check(prompt.x >= monitor.x && prompt.y >= monitor.y && prompt.x + prompt.width <= monitor.x + monitor.width &&
            prompt.y + prompt.height <= monitor.y + monitor.height, `prompt off monitor: ${JSON.stringify(prompt)}`);
        // policy rect: x 0.05, y 0.6, w 0.3, h max(0.14, 120px); prompt centred in it, then kept on the monitor.
        const keep = (v, lo, span, size) => Math.max(lo, Math.min(lo + span - size, v));
        const wantX = keep(monitor.x + 0.05 * monitor.width + (0.3 * monitor.width - prompt.width) / 2, monitor.x, monitor.width, prompt.width);
        const wantY = keep(monitor.y + 0.6 * monitor.height + (Math.max(120, 0.14 * monitor.height) - prompt.height) / 2,
            monitor.y, monitor.height, prompt.height);
        check(near(prompt.x, wantX) && near(prompt.y, wantY), `prompt not moved: ${JSON.stringify(prompt)} want ${wantX},${wantY}`);
        check(actors.prompt.visible && actors.prompt.opacity === 255, 'prompt hidden');

        // Retry after a failed attempt, without any password reaching PAM: emit GNOME's own
        // verification-failed signal (as its verifier would) and check the entry is usable again.
        // A real wrong-password retry is a manual check.
        const auth = actors.dialog._authPrompt;
        if (await waitFor(() => auth._queryingService && actors.authEntry.reactive, 5000)) {
            auth._userVerifier.emit('verification-failed', {serviceName: auth._queryingService, canRetry: true});
            await pause(500);
            console.log('LOCKSCREEN RETRY: simulated verification-failed');
        } else {
            actors.dialog.activate();
            await pause(500);
            console.log('LOCKSCREEN RETRY: no prompt question; re-activation only');
        }
        const retry = findLockActors();
        check(retry?.authEntry?.visible && retry.authEntry.reactive, 'auth entry not usable after a failed attempt');
        retry.authEntry.grab_key_focus();
        check(retry.authEntry.contains(global.stage.key_focus), 'auth entry does not accept focus after a failed attempt');
        const after = rect(retry.prompt);
        check(after.x >= monitor.x && after.x + after.width <= monitor.x + monitor.width, 'prompt off monitor after retry');

        // Runtime prompt fallback: no safe placement (policy null) leaves the prompt at GNOME's position.
        const runtime = theme.stateObj;
        runtime._placements.prompt = null;
        runtime._place();
        await pause(300);
        check(retry.prompt.translation_x === 0 && retry.prompt.translation_y === 0 && retry.prompt.visible,
            `prompt moved without a safe placement: ${retry.prompt.translation_x},${retry.prompt.translation_y}`);
        runtime._reapply();
        await pause(300);

        // Monitor change re-applies (real monitor removal needs a live session).
        Main.layoutManager.emit('monitors-changed');
        await pause(300);
        actors = findLockActors();
        this.checkStyled(actors, 'monitors-changed');

        // A failure while applying restores that actor (and the prompt) and reports it in `status`.
        const move = runtime._move;
        runtime._move = function (actor, state) {
            if (state.key === 'clock') throw new Error('injected');
            return move.call(this, actor, state);
        };
        runtime._reapply();
        runtime._move = move;
        await pause(500); // allocation passes must not re-move or re-style the failed actor
        actors = findLockActors();
        check(settings.get_string('status').startsWith('error: clock: injected'), `status not set: ${settings.get_string('status')}`);
        check(!actors.clock.style?.includes('#abcdef') && actors.clock.translation_x === 0, 'failed clock not restored');
        check(actors.prompt.visible && actors.authEntry?.visible, 'prompt hidden after a failure');
        check(actors.prompt.translation_x === 0 && actors.prompt.translation_y === 0, 'failed apply left the prompt moved');
        runtime._reapply();
        check(settings.get_string('status') === '', 'status not cleared after a good apply');
        this.checkStyled(findLockActors(), 'after failure');

        // Disable while locked restores GNOME's layout; the prompt stays visible.
        Main.extensionManager.disableExtension(UUID);
        await pause(300);
        actors = findLockActors();
        check(!actors.clock.style?.includes('#abcdef') && actors.clock.translation_x === 0 && actors.clock.translation_y === 0,
            `disable left clock changed: ${actors.clock.style} ${actors.clock.translation_x},${actors.clock.translation_y}`);
        check(actors.prompt.translation_x === 0 && actors.prompt.translation_y === 0 && actors.prompt.visible,
            `disable left prompt moved: ${actors.prompt.translation_x},${actors.prompt.translation_y}`);
        check(!actors.dialog.get_children().some(a => a.name?.startsWith('charcoal-lock')), 'disable left blocks behind');
        check(findLockActors()?.authEntry?.visible, 'auth entry gone after disable');
        Main.extensionManager.enableExtension(UUID);
        await pause(300);
        this.checkStyled(findLockActors(), 're-enable');

        // Lock/unlock twice.
        await this.unlock();
        this.checkStyled(await this.lock(), 'lock 2');
        // Theme link, on a fresh lock (GNOME slides the clock away once the prompt shows). The
        // runtime reads through ThemeClient('lockscreen'); the engine's schema and a profile file
        // are enough for the client to resolve themed values, so the engine itself is not run.
        await this.checkTheme(theme.stateObj, settings);
        await this.unlock();
        this.checkStyled(await this.lock(), 'lock 3');
        await this.unlock();
        check(settings.get_string('status') === '', `runtime error: ${settings.get_string('status')}`);

        // actors.js restore still works on its own.
        actors = await this.lock();
        const snapshot = snapshotActors(actors);
        actors.clock.style = 'color: #123456;';
        restoreActors(snapshot);
        check(actors.clock.style === snapshot.get(actors.clock).style, 'actor restore failed');
        console.log('LOCKSCREEN PASS'); global.context.terminate();
    }
}
