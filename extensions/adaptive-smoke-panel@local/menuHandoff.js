// Keep GNOME's grab/focus handling and incoming fade, without two blurred menus
// animating together. Limit this to the clock/quick-settings pair.
export function installMenuHandoff(manager, menus) {
    const pair = new Set(menus.filter(Boolean));
    if (!manager || pair.size !== 2)
        return () => {};
    const original = manager._changeMenu;
    function handoff(next) {
        const previous = this.activeMenu;
        if (!previous?.isOpen || previous === next || !pair.has(previous) || !pair.has(next))
            return original.call(this, next);
        const close = previous.close;
        const ownClose = Object.hasOwn(previous, 'close');
        previous.close = function (params = {}) {
            return close.call(this, {...params, animate: false});
        };
        try {
            return original.call(this, next);
        } finally {
            if (ownClose)
                previous.close = close;
            else
                delete previous.close;
        }
    }
    manager._changeMenu = handoff;
    return () => {
        if (manager._changeMenu === handoff)
            manager._changeMenu = original;
    };
}
