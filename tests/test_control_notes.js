// gjs -m tests/test_control_notes.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {saveNote} from '../extensions/charcoal-controls@local/notes.js';

const dir = GLib.dir_make_tmp('charcoal-notes-XXXXXX');
try {
    let rejected = false;
    try { saveNote(' \n ', dir); } catch { rejected = true; }
    if (!rejected) throw new Error('empty note accepted');
    const text = 'Hello 🌙\nSecond line\n';
    const path = saveNote(text, dir);
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    if (new TextDecoder().decode(bytes) !== text) throw new Error('note changed during save');
    Gio.File.new_for_path(path).delete(null);
} finally { Gio.File.new_for_path(dir).delete(null); }
print('control notes: ok');
