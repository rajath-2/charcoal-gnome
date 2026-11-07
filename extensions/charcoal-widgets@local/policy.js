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
