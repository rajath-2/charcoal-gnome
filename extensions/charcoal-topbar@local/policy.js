// Auto layout: islands while an app is maximized on `monitor`, the full bar otherwise.
// `inverted` swaps the two: islands on an empty desktop, full bar over a maximized app.
export function useIslands(windows, monitor, inverted = false) {
    const maximized = windows.some(w => w.visible && !w.minimized && w.normal &&
        w.monitor === monitor && w.horizontal && w.vertical);
    return maximized !== inverted;
}
