export const WHEEL_ITEMS = [
    ['lock', 'Lock'], ['note', 'Note'], ['settings', 'Settings'], ['themes', 'Themes'],
    ['suspend', 'Suspend'], ['logout', 'Log out'], ['restart', 'Restart'], ['poweroff', 'Power off'],
];

export function nextWheelState(state, event) {
    if (event === 'close') return 'closed';
    if (state === 'closed') return event === 'open' ? 'actions' : 'closed';
    if (event === 'themes' && state === 'actions') return 'themes';
    if (event === 'back' && state === 'themes') return 'actions';
    if (event === 'confirm' && state === 'actions') return 'confirm';
    if (event === 'back' && state === 'confirm') return 'actions';
    return state;
}

export function clampWheel(x, y, monitor, radius) {
    const r = Math.min(radius, monitor.width / 2, monitor.height / 2);
    return {x: Math.max(monitor.x + r, Math.min(x, monitor.x + monitor.width - r)),
        y: Math.max(monitor.y + r, Math.min(y, monitor.y + monitor.height - r)), radius: r};
}

export function pickWheelItem(x, y, geometry, ids, neutralRadius = 36) {
    if (!ids.length) return null;
    const dx = x - geometry.x, dy = y - geometry.y;
    const distance = Math.hypot(dx, dy);
    if (distance < Math.min(neutralRadius, geometry.radius / 2) || distance > geometry.radius) return null;
    const angle = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    return ids[Math.floor((angle + Math.PI / ids.length) % (2 * Math.PI) / (2 * Math.PI / ids.length))];
}

export function releaseSelection(pressed, released, dispatched) {
    return !dispatched && pressed && pressed === released ? pressed : null;
}

export function themeItems(profiles, activeId) {
    return profiles.map(profile => [profile.id, `${profile.id === activeId ? '● ' : ''}${profile.name}`]);
}
