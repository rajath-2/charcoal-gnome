import {THEME_KEYS} from './theme-catalog.js';

const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validValue(value, rule) {
    if (rule.type === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    if (rule.type === 'boolean') return typeof value === 'boolean';
    if (rule.type === 'integer') return Number.isInteger(value) && value >= rule.min && value <= rule.max;
    if (rule.type === 'number') return Number.isFinite(value) && value >= rule.min && value <= rule.max;
    if (rule.type === 'choice') return rule.values.includes(value);
    if (rule.type === 'text') return typeof value === 'string' && value.length <= 256 && !value.includes('\0');
    if (rule.type === 'json') {
        if (typeof value !== 'string' || value.length > 16384) return false;
        try { return !!JSON.parse(value) && !Array.isArray(JSON.parse(value)); }
        catch { return false; }
    }
    return false;
}

export function validateProfile(raw, catalog = THEME_KEYS) {
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, profile: null, errors: ['Profile must be an object']};
    if (raw.version !== 1) errors.push('Unsupported profile version');
    if (typeof raw.id !== 'string' || !idPattern.test(raw.id)) errors.push('Invalid profile ID');
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) errors.push('Invalid profile name');
    if (raw.wallpaper !== null && raw.wallpaper !== undefined &&
        (typeof raw.wallpaper !== 'string' || !raw.wallpaper.startsWith('file://')))
        errors.push('Invalid wallpaper URI');
    if (!raw.components || typeof raw.components !== 'object' || Array.isArray(raw.components))
        errors.push('Components must be an object');
    else for (const [component, values] of Object.entries(raw.components)) {
        const rules = catalog[component];
        if (!rules || !values || typeof values !== 'object' || Array.isArray(values)) {
            errors.push(`Invalid component: ${component}`); continue;
        }
        for (const [key, value] of Object.entries(values)) {
            if (!rules[key] || !validValue(value, rules[key])) errors.push(`Invalid value: ${component}.${key}`);
        }
    }
    return {ok: errors.length === 0, profile: errors.length ? null : raw, errors};
}

export function updateProfile(store, id, patch) {
    if (!Object.hasOwn(store, id)) throw new Error(`Unknown theme: ${id}`);
    if (patch.id !== undefined && patch.id !== id) throw new Error('Theme ID cannot change');
    const profile = {...store[id], ...patch, id};
    const checked = validateProfile(profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return {...store, [id]: profile};
}
