// Pure layout/style policy for the lock screen (no gi:// imports, testable in Node).
export const ELEMENTS = ['clock', 'date', 'user', 'prompt', 'status', 'notifications', 'text', 'image'];
export const MIN_PROMPT = {width: 240, height: 120};

export const DEFAULT_LAYOUT = {
    clock: {x: 0.3, y: 0.18, w: 0.4, h: 0.15, visible: true},
    date: {x: 0.35, y: 0.33, w: 0.3, h: 0.05, visible: true},
    user: {x: 0.35, y: 0.45, w: 0.3, h: 0.06, visible: true},
    prompt: {x: 0.35, y: 0.52, w: 0.3, h: 0.14, visible: true},
    status: {x: 0.3, y: 0.68, w: 0.4, h: 0.05, visible: true},
    notifications: {x: 0.3, y: 0.76, w: 0.4, h: 0.15, visible: true},
    text: {x: 0.3, y: 0.05, w: 0.4, h: 0.06, visible: false},
    image: {x: 0.05, y: 0.05, w: 0.15, h: 0.15, visible: false},
};

export const DEFAULT_STYLE = {
    'font-family': 'Sans', 'font-weight': 400, 'font-size': 24,
    'text-color': '#f2ece4', 'accent-color': '#d9903d', 'panel-color': '#15110d',
    'border-width': 1, 'border-radius': 12, 'shadow-size': 12, spacing: 8,
    'lock-wallpaper': '',
};

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const rnd = Math.round;

function readElement(name, raw) {
    const d = DEFAULT_LAYOUT[name], r = raw && typeof raw === 'object' ? raw : {};
    const w = num(r.w, 0.02, 1, d.w), h = num(r.h, 0.02, 1, d.h);
    return {
        x: num(r.x, 0, 1 - w, d.x), y: num(r.y, 0, 1 - h, d.y), w, h,
        visible: name === 'prompt' ? true : typeof r.visible === 'boolean' ? r.visible : d.visible,
        monitor: Number.isInteger(r.monitor) ? r.monitor : null,
    };
}

// Keep the authentication area on the monitor with at least MIN_PROMPT (or the whole monitor if smaller).
// Returns null (leave GNOME's own position) for an invalid request or one entirely off the monitor.
export function safePromptRect(requested, monitor) {
    const r = requested && typeof requested === 'object' ? requested : {};
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
    if (!(monitor?.width > 0 && monitor?.height > 0)) return null;
    if (r.x >= monitor.x + monitor.width || r.x + r.width <= monitor.x ||
        r.y >= monitor.y + monitor.height || r.y + r.height <= monitor.y) return null;
    const width = Math.min(monitor.width, Math.max(MIN_PROMPT.width, r.width));
    const height = Math.min(monitor.height, Math.max(MIN_PROMPT.height, r.height));
    return {
        x: rnd(Math.min(monitor.x + monitor.width - width, Math.max(monitor.x, r.x))),
        y: rnd(Math.min(monitor.y + monitor.height - height, Math.max(monitor.y, r.y))),
        width: rnd(width), height: rnd(height),
    };
}

// elements: {name: {x,y,w,h,visible,monitor?}} normalized to a monitor; returns pixel placements.
export function layoutLockElements(elements, monitors, primaryIndex) {
    if (!Array.isArray(monitors) || !monitors.length) return {};
    const ok = i => Number.isInteger(i) && i >= 0 && i < monitors.length;
    const out = {};
    for (const name of ELEMENTS) {
        const e = readElement(name, elements?.[name]);
        const index = ok(e.monitor) ? e.monitor : ok(primaryIndex) ? primaryIndex : 0;
        const m = monitors[index];
        let rect = {x: rnd(m.x + e.x * m.width), y: rnd(m.y + e.y * m.height), width: rnd(e.w * m.width), height: rnd(e.h * m.height)};
        if (name === 'prompt') {
            rect = safePromptRect(rect, m);
            if (!rect) { out.prompt = null; continue; }
        }
        out[name] = {...rect, visible: e.visible, monitor: index};
    }
    return out;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const FAMILY = /^[\w .-]{1,64}$/;

const ALIGN = ['start', 'center', 'end'];
const color = (v, d) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : d);
const family = (v, d) => (typeof v === 'string' && FAMILY.test(v) ? v : d);
const weight = (v, d) => (Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0 ? v : d);

export function readStyle(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_STYLE;
    return {
        'font-family': family(r['font-family'], d['font-family']),
        'font-weight': weight(r['font-weight'], d['font-weight']),
        'font-size': rnd(num(r['font-size'], 8, 200, d['font-size'])),
        'text-color': color(r['text-color'], d['text-color']),
        'accent-color': color(r['accent-color'], d['accent-color']),
        'panel-color': color(r['panel-color'], d['panel-color']),
        'border-width': rnd(num(r['border-width'], 0, 16, d['border-width'])),
        'border-radius': rnd(num(r['border-radius'], 0, 64, d['border-radius'])),
        'shadow-size': rnd(num(r['shadow-size'], 0, 64, d['shadow-size'])),
        spacing: rnd(num(r.spacing, 0, 64, d.spacing)),
        'lock-wallpaper': typeof r['lock-wallpaper'] === 'string' ? r['lock-wallpaper'] : '',
    };
}

// Effective style for one element: valid per-element overrides win, everything else is the global style.
export function readElementStyle(globalStyle, elementStylesJson, element) {
    const g = readStyle(globalStyle);
    const base = {
        'font-family': g['font-family'], 'font-weight': g['font-weight'], 'font-size': g['font-size'],
        color: g['text-color'], 'border-color': g['accent-color'], 'border-width': g['border-width'],
        'border-radius': g['border-radius'], 'shadow-color': g['accent-color'], 'shadow-size': g['shadow-size'],
        spacing: g.spacing, align: 'center',
    };
    let all;
    try { all = typeof elementStylesJson === 'string' ? JSON.parse(elementStylesJson) : elementStylesJson; } catch (e) { all = null; }
    const o = ELEMENTS.includes(element) && all && typeof all === 'object' ? all[element] : null;
    if (!o || typeof o !== 'object') return base;
    return {
        'font-family': family(o['font-family'], base['font-family']),
        'font-weight': weight(o['font-weight'], base['font-weight']),
        'font-size': rnd(num(o['font-size'], 8, 200, base['font-size'])),
        color: color(o.color, base.color),
        'border-color': color(o['border-color'], base['border-color']),
        'border-width': rnd(num(o['border-width'], 0, 16, base['border-width'])),
        'border-radius': rnd(num(o['border-radius'], 0, 64, base['border-radius'])),
        'shadow-color': color(o['shadow-color'], base['shadow-color']),
        'shadow-size': rnd(num(o['shadow-size'], 0, 64, base['shadow-size'])),
        spacing: rnd(num(o.spacing, 0, 64, base.spacing)),
        align: ALIGN.includes(o.align) ? o.align : base.align,
    };
}
