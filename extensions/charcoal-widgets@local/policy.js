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
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';

export function parseForecast(json) {
    const values = [json?.current?.temperature_2m, json?.daily?.temperature_2m_max?.[0],
        json?.daily?.temperature_2m_min?.[0], json?.current?.weather_code];
    if (!values.every(Number.isFinite))
        return null;
    const [temperature, high, low, code] = values.map(Math.round);
    return {temperature, high, low, code, isDay: json.current.is_day !== 0};
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

// Calendar: whole weeks covering `month` (0-11), starting on `weekStart` (0 = Sunday).
export function monthGrid(year, month, weekStart) {
    const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells = Math.ceil((offset + days) / 7) * 7;
    return Array.from({length: cells}, (_, i) => {
        const date = new Date(year, month, 1 - offset + i);
        return {date, inMonth: date.getMonth() === month};
    });
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
