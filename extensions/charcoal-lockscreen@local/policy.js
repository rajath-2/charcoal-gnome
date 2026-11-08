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

// Keep the authentication area fully on the monitor and at least MIN_PROMPT (or the whole monitor if smaller).
export function safePromptRect(requested, monitor) {
    const r = requested && typeof requested === 'object' ? requested : {};
    const width = Math.min(monitor.width, Math.max(MIN_PROMPT.width, num(r.width, 0, Infinity, MIN_PROMPT.width)));
    const height = Math.min(monitor.height, Math.max(MIN_PROMPT.height, num(r.height, 0, Infinity, MIN_PROMPT.height)));
    const fx = Number.isFinite(r.x) ? r.x : monitor.x + (monitor.width - width) / 2;
    const fy = Number.isFinite(r.y) ? r.y : monitor.y + (monitor.height - height) / 2;
    return {
        x: rnd(Math.min(monitor.x + monitor.width - width, Math.max(monitor.x, fx))),
        y: rnd(Math.min(monitor.y + monitor.height - height, Math.max(monitor.y, fy))),
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
        if (name === 'prompt') rect = safePromptRect(rect, m);
        out[name] = {...rect, visible: e.visible, monitor: index};
    }
    return out;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const FAMILY = /^[\w .-]{1,64}$/;

export function readStyle(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_STYLE;
    const color = k => (typeof r[k] === 'string' && COLOR.test(r[k]) ? r[k].toLowerCase() : d[k]);
    const weight = r['font-weight'];
    return {
        'font-family': typeof r['font-family'] === 'string' && FAMILY.test(r['font-family']) ? r['font-family'] : d['font-family'],
        'font-weight': Number.isInteger(weight) && weight >= 100 && weight <= 900 && weight % 100 === 0 ? weight : d['font-weight'],
        'font-size': rnd(num(r['font-size'], 8, 200, d['font-size'])),
        'text-color': color('text-color'), 'accent-color': color('accent-color'), 'panel-color': color('panel-color'),
        'border-width': rnd(num(r['border-width'], 0, 16, d['border-width'])),
        'border-radius': rnd(num(r['border-radius'], 0, 64, d['border-radius'])),
        'shadow-size': rnd(num(r['shadow-size'], 0, 64, d['shadow-size'])),
        spacing: rnd(num(r.spacing, 0, 64, d.spacing)),
        'lock-wallpaper': typeof r['lock-wallpaper'] === 'string' ? r['lock-wallpaper'] : '',
    };
}
