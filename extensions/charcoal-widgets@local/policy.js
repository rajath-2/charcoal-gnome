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

// Weather: Open-Meteo, no API key. Malformed responses give null / [] so the widget never throws.
export const geocodeUrl = name =>
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;

export function parseGeocode(json) {
    if (!Array.isArray(json?.results))
        return [];
    return json.results.filter(r => typeof r?.name === 'string' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
        .map(r => ({label: [r.name, r.admin1, r.country].filter(part => typeof part === 'string' && part).join(', '),
            latitude: r.latitude, longitude: r.longitude}));
}

export const forecastUrl = (lat, lon) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';

export function parseForecast(json) {
    const values = [json?.current?.temperature_2m, json?.daily?.temperature_2m_max?.[0],
        json?.daily?.temperature_2m_min?.[0], json?.current?.weather_code];
    if (!values.every(Number.isFinite))
        return null;
    const [temperature, high, low, code] = values.map(Math.round);
    // Extras only the large layout shows; missing ones are null.
    const extra = key => Number.isFinite(json.current[key]) ? Math.round(json.current[key]) : null;
    return {temperature, high, low, code, isDay: json.current.is_day !== 0,
        feelsLike: extra('apparent_temperature'), humidity: extra('relative_humidity_2m'), wind: extra('wind_speed_10m')};
}

// WMO weather interpretation codes.
const WEATHER = [
    [[0], 'Clear', 'weather-clear-symbolic', 'weather-clear-night-symbolic'],
    [[1, 2], 'Partly cloudy', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [[3], 'Overcast', 'weather-overcast-symbolic'],
    [[45, 48], 'Fog', 'weather-fog-symbolic'],
    [[51, 52, 53, 54, 55, 56, 57], 'Drizzle', 'weather-showers-scattered-symbolic'],
    [[61, 62, 63, 64, 65, 66, 67, 80, 81, 82], 'Rain', 'weather-showers-symbolic'],
    [[71, 72, 73, 74, 75, 76, 77, 85, 86], 'Snow', 'weather-snow-symbolic'],
    [[95, 96, 97, 98, 99], 'Thunderstorm', 'weather-storm-symbolic'],
];
export function describeWeather(code, isDay) {
    const [, text, day, night = day] = WEATHER.find(([codes]) => codes.includes(code)) ??
        [[], 'Unknown', 'weather-overcast-symbolic'];
    return {text, icon: isDay ? day : night};
}

// Calendar: six weeks, padded exactly like the top bar's calendar (shell ui/calendar.js), so the
// current month asks GNOME's calendar server for the same range as the date menu does.
export function monthGrid(year, month, weekStart) {
    const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    const start = 1 - offset - (offset === 0 ? 7 : 0);
    return Array.from({length: 42}, (_, i) => {
        const date = new Date(year, month, start + i);
        return {date, inMonth: date.getMonth() === month};
    });
}

// org.gnome.desktop.calendar week-start-day: 0 = locale default, 1 = Monday ... 7 = Sunday.
export const weekStartDay = (setting, localeStart) => setting === 0 ? localeStart : setting % 7;

// Weather schedule on wall-clock microseconds (it keeps running through suspend): every 30 minutes
// after a success; after failures, retry in 1, 2, 4 ... minutes, at most 30.
const REFRESH_US = 30 * 60e6;
export function weatherDue({now, lastAttempt, lastSuccess, failures}) {
    if (lastAttempt === null)
        return true;
    const wait = failures > 0 ? Math.min(REFRESH_US, 60e6 * 2 ** (failures - 1)) : REFRESH_US;
    return now - (failures > 0 ? lastAttempt : lastSuccess) >= wait;
}

// Music: follow the playing player; with none playing, the one that changed most recently.
export function pickPlayer(players) {
    const latest = list => list.reduce((best, p) => !best || p.changedAt > best.changedAt ? p : best, null);
    return (latest(players.filter(p => p.status === 'Playing')) ?? latest(players))?.name ?? null;
}

// Players send buggy metadata (MPRIS spec says artist is a string array, some send a string).
export function trackInfo(metadata) {
    const m = metadata ?? {};
    const artists = m['xesam:artist'];
    const length = Number(m['mpris:length']);
    return {
        title: typeof m['xesam:title'] === 'string' && m['xesam:title'] ? m['xesam:title'] : 'Unknown title',
        artist: Array.isArray(artists) && artists.every(a => typeof a === 'string') ? artists.join(', ') : '',
        album: typeof m['xesam:album'] === 'string' ? m['xesam:album'] : '',
        artUrl: typeof m['mpris:artUrl'] === 'string' ? m['mpris:artUrl'] : '',
        length: Number.isFinite(length) && length > 0 ? length : 0,
        trackId: typeof m['mpris:trackid'] === 'string' ? m['mpris:trackid'] : '',
    };
}

export function formatTime(us) {
    const total = Number.isFinite(us) && us > 0 ? Math.floor(us / 1e6) : 0;
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const LOOPS = ['None', 'Playlist', 'Track'];
export const nextLoop = status => LOOPS.includes(status) ? LOOPS[(LOOPS.indexOf(status) + 1) % 3] : 'Playlist';

// OpenStreetMap's search knows city aliases Open-Meteo lacks ("Bangalore" -> Bengaluru).
export const placeSearchUrl = name =>
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=jsonv2&limit=5&addressdetails=1&accept-language=en&featureType=settlement`;

export function parsePlaceSearch(json) {
    if (!Array.isArray(json))
        return [];
    return json.map(r => ({r, latitude: Number(r?.lat), longitude: Number(r?.lon)}))
        .filter(({r, latitude, longitude}) => typeof r?.name === 'string' && r.name && Number.isFinite(latitude) && Number.isFinite(longitude))
        .map(({r, latitude, longitude}) => ({
            label: [r.name, r.address?.state, r.address?.country].filter(part => typeof part === 'string' && part).join(', '),
            latitude, longitude,
        }));
}

// Same label, or within ~10 km, counts as the same place; the first list wins.
export function mergePlaces(first, second) {
    const same = (a, b) => a.label === b.label ||
        (Math.abs(a.latitude - b.latitude) < 0.1 && Math.abs(a.longitude - b.longitude) < 0.1);
    return [...first, ...second].filter((place, i, all) => all.findIndex(other => same(place, other)) === i);
}

export function weekGrid(selected, weekStart) {
    const offset = (selected.getDay() - weekStart + 7) % 7;
    return Array.from({length: 7}, (_, i) =>
        new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() - offset + i));
}

// Inner content dimensions, in typography-independent pixels. Width AND height matter:
// a long thin card cannot show the same information as a square of the same area.
export const DEFAULT_CONTENT_SIZE = {calendar: [280, 330], weather: [230, 110], music: [340, 210]};
export function widgetLayout(name, width, height, scale = 1, displayScale = 1) {
    const w = width / (scale * displayScale), h = height / (scale * displayScale);
    if (name === 'calendar') {
        const mode = w >= 224 && h >= 250 ? 'month' : w >= 224 && h >= 150 ? 'week' : 'compact';
        const sideBySide = mode === 'month' && w >= 520;
        const remaining = h - (sideBySide ? 108 : mode === 'month' ? 258 : mode === 'week' ? 110 : 78);
        return {mode, sideBySide, events: Math.max(0, Math.min(6, Math.floor(remaining / 22))),
            summary: mode === 'compact' || sideBySide};
    }
    if (name === 'weather') {
        const horizontal = w >= 360;
        return {horizontal, condition: h >= (horizontal ? 28 : 80),
            detail: w >= 160 && h >= (horizontal ? 52 : 105),
            extra: w >= 200 && h >= (horizontal ? 145 : 195)};
    }
    const mode = w >= 400 && h < 160 ? 'strip' : h >= 150 ? 'stack' : 'compact';
    return {mode, art: w >= (mode === 'compact' ? 280 : 220) && h >= 64, artist: w >= 200 && h >= 100,
        album: w >= 240 && h >= 260, skip: w >= (mode === 'strip' ? 520 : 220) && (mode === 'strip' || h >= 150),
        seek: w >= 220 && h >= 205, secondary: w >= 300 && h >= 180};
}

// A widget's own shape, drawn by dragging its edges: {name: {width, height}} in logical pixels.
export const MIN_CARD = 80;

export function resizeEdges(rect, px, py, margin = 12) {
    const {x, y, width, height} = rect;
    const inside = px >= x && px <= x + width && py >= y && py <= y + height;
    return {left: inside && px < x + margin, right: inside && px >= x + width - margin,
        top: inside && py < y + margin, bottom: inside && py >= y + height - margin};
}

// Always measure from the press rectangle, not the moving top-left corner. Clamp dimensions
// before computing the new origin so the opposite edge stays fixed at the minimum size.
export function resizeRect(rect, edges, dx, dy) {
    const width = Math.max(MIN_CARD, Math.round(rect.width + (edges.left ? -dx : edges.right ? dx : 0)));
    const height = Math.max(MIN_CARD, Math.round(rect.height + (edges.top ? -dy : edges.bottom ? dy : 0)));
    return {x: edges.left ? rect.x + rect.width - width : rect.x,
        y: edges.top ? rect.y + rect.height - height : rect.y, width, height};
}

export function readSize(json, name) {
    let saved = null;
    try {
        saved = JSON.parse(json)?.[name];
    } catch {}
    if (!Number.isFinite(saved?.width) || !Number.isFinite(saved?.height))
        return null;
    return {width: Math.max(MIN_CARD, Math.round(saved.width)), height: Math.max(MIN_CARD, Math.round(saved.height))};
}

// Content in a box of the user's shape: stretch to the box's width when the content can, else
// lay it out at its minimum width; then scale it down (never up) until it fits, centered.
// measure(width) gives the content's natural height at that width.
export function fitContent(boxW, boxH, minW, measure) {
    const fit = width => Math.min(1, boxW / width, boxH / Math.max(1, measure(width)));
    let width = Math.max(boxW, minW);
    let scale = fit(width);
    // Scaled down for height: lay out wider so the scaled content still fills the width.
    if (scale < 1) {
        width = Math.max(boxW / scale, minW);
        scale = fit(width);
    }
    return {width, height: measure(width), scale};
}

// Settings hold one JSON object per key, {name: value}, shared by the three cards. `effective` is
// the value the cards are drawn from (the theme's when linked), so the other cards keep their spots.
export function mergeCardValue(effective, name, value) {
    let saved = {};
    try { saved = JSON.parse(effective); } catch {}
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) saved = {};
    return JSON.stringify({...saved, [name]: value});
}
