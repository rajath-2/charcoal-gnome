import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function saveNote(text, dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'charcoal', 'notes'])) {
    if (!text.trim()) throw new Error('Write a note before saving');
    GLib.mkdir_with_parents(dir, 0o700);
    const path = GLib.build_filenamev([dir, `${GLib.uuid_string_random()}.txt`]);
    Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.PRIVATE, null);
    return path;
}
