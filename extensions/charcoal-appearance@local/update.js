// GreyStone icon updates from upstream. Shared by extension.js and prefs.js (no Shell imports).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

export const THEME = 'GreyStone - circle';
export const SOURCE = 'https://codeberg.org/StormRosenaa/GreyStone';
const RAW = `${SOURCE}/raw/branch/main/`;

// Upstream changelog starts with "Version 4.5".
export function parseVersion(text) {
    return /^Version\s+(\d+(?:\.\d+)*)/m.exec(text ?? '')?.[1] ?? null;
}

export function isNewer(candidate, current) {
    const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff)
            return diff > 0;
    }
    return false;
}

export function themeDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'icons', THEME]);
}

function readVersion(dir) {
    try {
        return parseVersion(new TextDecoder().decode(GLib.file_get_contents(`${dir}/changelog`)[1]));
    } catch {
        return null;
    }
}

export function installedVersion() {
    return readVersion(themeDir());
}

async function fetch(session, url, cancellable) {
    const message = Soup.Message.new('GET', url);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()} for ${url}`);
    return bytes;
}

async function run(argv, cancellable) {
    await Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_SILENCE).wait_check_async(cancellable);
}

// Returns the new version after updating, or null when already current / not installed by us.
// The installed theme is only replaced after the new copy downloaded, extracted and checked out.
export async function updateIcons(cancellable = null) {
    const dir = themeDir();
    if (!GLib.file_test(`${dir}/index.theme`, GLib.FileTest.EXISTS))
        return null;
    const current = installedVersion();
    const session = new Soup.Session({timeout: 60});
    const latest = parseVersion(new TextDecoder().decode((await fetch(session, `${RAW}changelog`, cancellable)).get_data()));
    if (!latest)
        throw new Error('Could not read the upstream version');
    if (current && !isNewer(latest, current))
        return null;
    // Same filesystem as the theme, so the final swap is two renames.
    const work = GLib.build_filenamev([GLib.path_get_dirname(dir), `.charcoal-icons-${GLib.uuid_string_random()}`]);
    Gio.File.new_for_path(work).make_directory(null);
    try {
        const archive = Gio.File.new_for_path(`${work}/theme.tar.gz`);
        const bytes = await fetch(session, `${RAW}${encodeURIComponent(THEME)}.tar.gz`, cancellable);
        await archive.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, cancellable);
        await run(['tar', '-xzf', archive.get_path(), '-C', work, '--no-same-owner', '--no-same-permissions'], cancellable);
        const fresh = `${work}/${THEME}`;
        if (!GLib.file_test(`${fresh}/index.theme`, GLib.FileTest.EXISTS) || readVersion(fresh) !== latest)
            throw new Error('Downloaded theme is incomplete');
        const old = Gio.File.new_for_path(`${work}/previous`);
        Gio.File.new_for_path(dir).move(old, Gio.FileCopyFlags.NONE, null, null);
        try {
            Gio.File.new_for_path(fresh).move(Gio.File.new_for_path(dir), Gio.FileCopyFlags.NONE, null, null);
        } catch (error) {
            old.move(Gio.File.new_for_path(dir), Gio.FileCopyFlags.NONE, null, null);
            throw error;
        }
        return latest;
    } finally {
        await run(['rm', '-rf', '--', work], null).catch(() => {});
    }
}
