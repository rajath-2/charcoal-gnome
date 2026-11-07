// gjs -m tests/test_icon_update.js            offline checks
// ICON_UPDATE_NETWORK=1 gjs -m ...            also downloads upstream into a temporary XDG_DATA_HOME
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {parseVersion, isNewer, installedVersion, updateIcons, themeDir} from '../extensions/charcoal-appearance@local/update.js';

const assert = (ok, message) => { if (!ok) throw new Error(`FAIL: ${message}`); };
assert(parseVersion('Version 4.5\n-----') === '4.5', 'parse version');
assert(parseVersion('nothing') === null, 'no version');
assert(isNewer('4.10', '4.9') && isNewer('5', '4.9.9') && !isNewer('4.5', '4.5') && !isNewer('4.4', '4.5'), 'compare versions');
print('offline: ok');

if (GLib.getenv('ICON_UPDATE_NETWORK') === '1') {
    // Run with XDG_DATA_HOME pointing at a scratch folder: an old 4.4 copy must be replaced.
    const dir = themeDir();
    assert(dir.startsWith(GLib.getenv('XDG_DATA_HOME') ?? '/nonexistent'), 'refusing to touch the real icons folder');
    GLib.mkdir_with_parents(dir, 0o755);
    GLib.file_set_contents(`${dir}/index.theme`, '[Icon Theme]\nName=old\n');
    GLib.file_set_contents(`${dir}/changelog`, 'Version 4.4\n');
    const loop = new GLib.MainLoop(null, false);
    let failure = null;
    (async () => {
        try {
            const version = await updateIcons();
            assert(version && isNewer(version, '4.4'), `updated (got ${version})`);
            assert(installedVersion() === version, 'installed version matches');
            assert(GLib.file_test(`${dir}/apps`, GLib.FileTest.IS_DIR), 'real theme contents present');
            assert(await updateIcons() === null, 'second check is a no-op');
            const leftovers = [];
            const children = Gio.File.new_for_path(GLib.path_get_dirname(dir)).enumerate_children('standard::name', 0, null);
            for (const info of children) leftovers.push(info.get_name());
            assert(leftovers.length === 1, `no temp folders left (${leftovers})`);
            print(`network: updated 4.4 -> ${version}, ok`);
        } catch (error) {
            failure = error;
        }
        loop.quit();
    })();
    loop.run();
    if (failure) throw failure;
}
