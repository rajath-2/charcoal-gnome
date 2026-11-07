import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Dock mode: windows minimize into the cursor and open/restore out of it.
// GNOME's minimize/unminimize animations aim at a window's icon geometry (as docks set it);
// new windows grow from their pivot point, which we move to the cursor.
const NEW_WINDOW_TIMEOUT = 10; // seconds to wait for a launched app's first window

export function activateAtCursor(app, [x, y]) {
    const windows = app.get_windows().filter(window => !window.skip_taskbar);
    const point = new Mtk.Rectangle({x: Math.round(x) - 1, y: Math.round(y) - 1, width: 2, height: 2});
    for (const window of windows)
        window.set_icon_geometry(point);
    // Clear it afterwards so the title-bar minimize button keeps its normal animation.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        const open = app.get_windows();
        for (const window of windows.filter(w => open.includes(w)))
            window.set_icon_geometry(null);
        return GLib.SOURCE_REMOVE;
    });
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
