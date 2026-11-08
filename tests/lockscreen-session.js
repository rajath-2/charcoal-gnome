import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {findLockActors, snapshotActors, restoreActors} from '../charcoal-lockscreen@local/actors.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));

export default class LockTest extends Extension {
    enable() { this.run().catch(error => { console.error('LOCKSCREEN FAIL', error.message, error.stack); global.context.terminate(); }); }
    async run() {
        await pause(1500);
        Main.screenShield.lock(false);
        await pause(800);
        const actors = findLockActors();
        if (!actors?.clock || !actors.prompt) throw new Error('GNOME lock actors unavailable');
        actors.dialog.activate();
        await pause(500);
        const active = findLockActors();
        if (!active?.authEntry || !active.authEntry.visible) throw new Error('GNOME authentication entry unavailable');
        const snapshot = snapshotActors(active);
        active.clock.style = 'color: #abcdef;';
        restoreActors(snapshot);
        if (active.clock.style !== snapshot.get(active.clock).style) throw new Error('actor restore failed');
        console.log('LOCKSCREEN PASS'); global.context.terminate();
    }
}
