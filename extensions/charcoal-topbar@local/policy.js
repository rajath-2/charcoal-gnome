export function useIslands(windows, monitor) {
    return windows.some(w => w.visible && !w.minimized && w.normal &&
        w.monitor === monitor && w.horizontal && w.vertical);
}
