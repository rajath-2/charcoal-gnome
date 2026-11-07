import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Dock mode: windows minimize into the cursor and open/restore out of it.
// GNOME's minimize/unminimize animations aim at a window's icon geometry (as docks set it),
// falling back to the screen's top-left corner; new windows grow from their pivot point.
const NEW_WINDOW_TIMEOUT = 10; // seconds to wait for a launched app's first window

export function activateAtCursor(app, [x, y]) {
    // Minimize/restore aim at the cursor via CursorMinimize, which dock mode keeps enabled.
    const windows = app.get_windows().filter(window => !window.skip_taskbar);
    const focused = Shell.WindowTracker.get_default().focus_app === app;
    if (focused && windows.some(window => !window.minimized)) {
        for (const window of windows)
            window.minimize();
        return;
    }
    if (!windows.length) {
        growFromCursor(app, x, y);
        app.activate();
        return;
    }
    // Most recent window, with a real timestamp: unminimizes (out of the cursor) and is not
    // turned into a "ready" notification by focus-stealing prevention.
    Main.activateWindow(windows[0]);
}

// One specific window (picked from the previews). Dock mode: out of / into the cursor.
export function activateWindowAt(window, [x, y], dockMode) {
    if (!dockMode) {
        Main.activateWindow(window);
        return;
    }
    if (global.display.focus_window === window && !window.minimized) window.minimize();
    else Main.activateWindow(window);
}

function growFromCursor(app, x, y) {
    const tracker = Shell.WindowTracker.get_default();
    let timeout = 0;
    // Runs after GNOME's own map handler has set up its grow-in, so only the pivot changes.
    const id = global.window_manager.connect('map', (_, actor) => {
        if (tracker.get_window_app(actor.meta_window) !== app || !actor.width || !actor.height)
            return;
        actor.set_pivot_point((x - actor.x) / actor.width, (y - actor.y) / actor.height);
        done();
    });
    const done = () => {
        global.window_manager.disconnect(id);
        if (timeout)
            GLib.Source.remove(timeout);
        timeout = 0;
    };
    timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, NEW_WINDOW_TIMEOUT, () => {
        timeout = 0;
        done();
        return GLib.SOURCE_REMOVE;
    });
}

// Every minimize and restore in dock mode - wheel, Super+H, title-bar button - aims at the cursor.
// The minimized flag flips before Mutter runs the animation, which reads the icon geometry then.
export class CursorMinimize {
    constructor() { this.windows = new Map(); this.created = 0; }
    enable() {
        this.created = global.display.connect('window-created', (_, window) => this._watch(window));
        for (const actor of global.get_window_actors()) this._watch(actor.meta_window);
    }
    _watch(window) {
        if (!window || this.windows.has(window)) return;
        this.windows.set(window, [
            window.connect('notify::minimized', () => {
                const [x, y] = global.get_pointer();
                window.set_icon_geometry(new Mtk.Rectangle({x: x - 1, y: y - 1, width: 2, height: 2}));
            }),
            window.connect('unmanaged', () => this._unwatch(window)),
        ]);
    }
    _unwatch(window) {
        for (const id of this.windows.get(window) ?? []) window.disconnect(id);
        this.windows.delete(window);
    }
    disable() {
        if (this.created) global.display.disconnect(this.created);
        this.created = 0;
        // Hand the windows back to a regular dock (or GNOME's default) without stale targets.
        for (const window of [...this.windows.keys()]) { this._unwatch(window); window.set_icon_geometry(null); }
    }
}
