// Pure helpers for Charcoal Widgets: no gi:// imports, so tests run them under node.

const clamp01 = value => Math.min(1, Math.max(0, value));

// Fractions place a card within the monitor work area's free space (area minus card size),
// so any value in 0..1 keeps the whole card on screen. Layout C: weather top-left,
// calendar top-right, music bottom-center.
export const DEFAULT_POSITIONS = {
    weather: {monitor: 0, x: 0.02, y: 0.03},
    calendar: {monitor: 0, x: 0.98, y: 0.03},
    music: {monitor: 0, x: 0.5, y: 0.97},
};

export function readPositions(json, monitorCount, primary) {
    let saved = {};
    try {
        saved = JSON.parse(json);
    } catch {}
    if (typeof saved !== 'object' || saved === null) saved = {};
    const result = {};
    for (const [name, fallback] of Object.entries(DEFAULT_POSITIONS)) {
        const p = saved[name];
        const valid = p && Number.isInteger(p.monitor) && p.monitor >= 0 && p.monitor < monitorCount &&
            Number.isFinite(p.x) && Number.isFinite(p.y);
        result[name] = valid ? {monitor: p.monitor, x: clamp01(p.x), y: clamp01(p.y)} : {...fallback, monitor: primary};
    }
    return result;
}

const toAxis = (start, free, value) => free > 0 ? clamp01((value - start) / free) : 0;
export function toFraction(area, size, pos) {
    return {x: toAxis(area.x, area.width - size.width, pos.x), y: toAxis(area.y, area.height - size.height, pos.y)};
}

export function fromFraction(area, size, frac) {
    return {
        x: Math.round(area.x + clamp01(frac.x) * Math.max(0, area.width - size.width)),
        y: Math.round(area.y + clamp01(frac.y) * Math.max(0, area.height - size.height)),
    };
}

export function isDesktopClear(windows, monitor) {
    return !windows.some(w => w.normal && !w.minimized && w.monitor === monitor);
}

// Clutter renders an offscreen effect into a texture a little larger than the actor: this is that
// texture's [x, y, width, height] relative to the actor (copied from charcoal-topbar's morph.js).
export function effectBox(x, y, width, height) {
    const w = Math.round(width), h = Math.round(height);
    const x2 = Math.ceil(x + width + 0.75), y2 = Math.ceil(y + height + 0.75);
    return [x2 - w - 3 - x, y2 - h - 3 - y, w + 3, h + 3];
}
