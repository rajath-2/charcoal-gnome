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

// Three-finger touchpad wheel: rest the fingers to open, slide to aim, lift to launch.
// A swipe that starts before the hold delay is left to GNOME (workspaces, overview).
export class TouchpadWheel {
    constructor() { this.state = 'idle'; this.offset = [0, 0]; }
    hold(phase) {
        if (phase === 'begin') {
            if (this.state !== 'idle') return 'none';
            this.state = 'holding'; return 'start-timer';
        }
        if (this.state === 'holding') { this.state = 'idle'; return 'stop-timer'; }
        // Lifted without sliding. A cancelled hold just means the fingers started moving.
        if (this.state === 'open' && phase === 'end') { this.state = 'idle'; return 'close'; }
        return 'none';
    }
    timer() {
        if (this.state !== 'holding') return 'none';
        this.state = 'open'; this.offset = [0, 0]; return 'open';
    }
    swipe(phase, dx = 0, dy = 0, limit = Infinity) {
        if (this.state === 'holding' && phase === 'begin') { this.state = 'idle'; return 'stop-timer'; }
        if (this.state !== 'open') return 'none';
        if (phase === 'end') { this.state = 'idle'; return 'launch'; }
        if (phase === 'cancel') { this.state = 'idle'; return 'close'; }
        let [x, y] = [this.offset[0] + dx, this.offset[1] + dy];
        const length = Math.hypot(x, y);
        if (length > limit) [x, y] = [x * limit / length, y * limit / length];
        this.offset = [x, y];
        return 'aim';
    }
    reset() { this.state = 'idle'; this.offset = [0, 0]; }
}

// Where the window-preview panel goes: just outside the wheel, centred on the hovered sector's
// direction (angle in radians, 0 = right, clockwise), clamped inside the monitor.
export function previewPlacement(center, angle, radius, [width, height], monitor, gap = 12) {
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    // Distance from the panel's centre to its edge along the direction, so its near edge sits at radius + gap.
    const edge = Math.min(Math.abs(dx) > 1e-6 ? width / 2 / Math.abs(dx) : Infinity,
        Math.abs(dy) > 1e-6 ? height / 2 / Math.abs(dy) : Infinity);
    const distance = radius + gap + edge;
    const clamp = (v, low, high) => Math.min(Math.max(v, low), Math.max(low, high));
    return {x: Math.round(clamp(center[0] + dx * distance - width / 2, monitor.x + 8, monitor.x + monitor.width - width - 8)),
        y: Math.round(clamp(center[1] + dy * distance - height / 2, monitor.y + 8, monitor.y + monitor.height - height - 8))};
}

// Which sector the pointer picks. Rings are [{inner, outer, count}], innermost first, sharing
// one centre. Only the centre (inside the first ring) picks nothing: gaps between rings belong to
// the outer ring, and anywhere beyond the wheel picks the outermost ring in that direction, so
// overshooting or being slightly off still selects the app the pointer is aimed at.
export function pickSector(x, y, center, rings) {
    const distance = Math.hypot(x - center.x, y - center.y);
    if (!rings.length || distance <= rings[0].inner) return null;
    const ring = rings.findIndex(r => distance <= r.outer);
    const index = ring < 0 ? rings.length - 1 : ring;
    const sector = wheelSelection(x, y, {...center, radius: Infinity}, rings[index].count, 0);
    return sector < 0 ? null : {ring: index, sector};
}

// Inline style of a launcher surface (search panel, wheel previews) from its preference values,
// with the prefix already stripped from the key names.
const hexOr = value => /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080';
export const rgbaOf = (value, alpha) => `rgba(${[1, 3, 5].map(i => parseInt(hexOr(value).slice(i, i + 2), 16)).join(',')},${+alpha.toFixed(3)})`;
// The search panel's secondary colors, derived from its text and highlight colors
// (a fixed light grey would vanish on a light panel).
export function searchColorCss(text, accent) {
    const t = alpha => rgbaOf(text, alpha);
    return `.charcoal-search-entry { background-color: ${t(0.07)}; border: 1px solid ${t(0.1)}; }
.charcoal-search-entry:focus { border-color: ${rgbaOf(accent, 0.6)}; }
.charcoal-search-entry .hint-text { color: ${t(0.5)}; }
.charcoal-result:hover { background-color: ${t(0.08)}; }
.charcoal-detail, .charcoal-empty { color: ${t(0.65)}; }
.charcoal-heading { color: ${t(0.55)}; }
.charcoal-hint { color: ${t(0.6)}; }
`;
}
export function surfaceCss(o) {
    const border = o['border-width'] > 0
        ? `${o['border-width']}px solid ${rgbaOf(o['border-color'], o['border-opacity'] / 100)}` : 'none';
    const shadow = o['shadow-size'] > 0
        ? `0 ${Math.round(o['shadow-size'] * 3 / 8)}px ${o['shadow-size']}px 2px ${rgbaOf(o['shadow-color'], o['shadow-opacity'] / 100)}` : 'none';
    return `background-color: ${rgbaOf(o['background-color'], o['background-opacity'] / 100)};
        color: ${hexOr(o['foreground-color'])}; border-radius: ${o['corner-radius']}px;
        border: ${border}; box-shadow: ${shadow}; font-size: ${+(o['text-size'] / 100).toFixed(2)}em;`;
}

// dash-to-dock's Super+N shortcut names -> zero-based favorite index, or -1.
export function appHotkeyIndex(name) {
    const match = /^app-hotkey-(\d+)$/.exec(name);
    return match ? Number(match[1]) - 1 : -1;
}
