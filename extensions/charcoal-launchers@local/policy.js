// Pure interaction policies, also exercised outside GNOME by the Node test runner.
export class Gesture {
    state = 'idle';
    press() {
        if (this.state !== 'idle') return false;
        this.state = 'pending';
        return true;
    }
    open() {
        if (this.state === 'pending') this.state = 'open';
    }
    cancel() { this.state = 'idle'; }
    release(app) {
        const state = this.state;
        this.state = 'idle';
        if (state === 'pending') return {type: 'tap'};
        if (state === 'open' && app) return {type: 'launch', app};
        return {type: 'none'};
    }
}

export function wheelGeometry([x, y], monitor, radius) {
    const r = Math.max(1, Math.min(radius, (monitor.width - 24) / 2, (monitor.height - 24) / 2));
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    return {x: clamp(x, monitor.x + r + 12, monitor.x + monitor.width - r - 12),
        y: clamp(y, monitor.y + r + 12, monitor.y + monitor.height - r - 12), radius: r};
}

export function wheelSelection(x, y, geometry, count, deadZone) {
    const dx = x - geometry.x, dy = y - geometry.y;
    const distance = Math.hypot(dx, dy);
    if (!count || distance <= deadZone || distance > geometry.radius) return -1;
    const step = Math.PI * 2 / count;
    const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2 + step / 2) % (Math.PI * 2);
    return Math.floor(angle / step) % count;
}

export function restoreBindings(original, applied, current) {
    if (JSON.stringify(current) === JSON.stringify(applied)) return [...original];
    const restored = [...current];
    original.forEach((binding, index) => {
        if (!applied.includes(binding) && !restored.includes(binding))
            restored.splice(Math.min(index, restored.length), 0, binding);
    });
    return restored;
}

export class QueryGeneration {
    _value = 0;
    next() { return ++this._value; }
    current(value) { return this._value === value; }
}

export function appRings(favorites, running, dockMode, capacity = 8) {
    const pinned = [...new Set(favorites)];
    const rings = pinned.length ? [pinned] : [];
    if (dockMode) {
        const extra = [...new Set(running)].filter(id => !pinned.includes(id));
        for (let i = 0; i < extra.length; i += capacity) rings.push(extra.slice(i, i + capacity));
    }
    return rings;
}
