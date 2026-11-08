export function resolveValue({key, local, theme, linked, overrideActivation = {}, activationId}) {
    if (!linked || theme === undefined || theme === null) return local;
    return overrideActivation[key] === activationId && activationId !== undefined ? local : theme;
}

// Which theme-defined keys are currently overridden locally and which follow the theme (names only).
export function valueSources(keys, themeValues = {}, overrideActivation = {}, activationId) {
    const themed = keys.filter(key => themeValues[key] !== undefined && themeValues[key] !== null);
    const local = themed.filter(key => overrideActivation[key] === activationId && activationId !== undefined);
    return {local, theme: themed.filter(key => !local.includes(key))};
}

export function selectOverride(state, key, activationId) {
    return {...state, overrides: {...state.overrides, [key]: activationId}};
}

export function switchTheme(state, themeId) {
    return {...state, themeId, activationId: state.activationId + 1};
}

export function effectiveSnapshot(localSettings, themeClient) {
    return Object.fromEntries(localSettings.settings_schema.list_keys()
        .map(key => [key, themeClient.get(key)]));
}
