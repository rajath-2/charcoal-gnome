export function resolveValue({key, local, theme, linked, overrideActivation = {}, activationId}) {
    if (!linked || theme === undefined || theme === null) return local;
    return overrideActivation[key] === activationId && activationId !== undefined ? local : theme;
}

export function selectOverride(state, key, activationId) {
    return {...state, overrides: {...state.overrides, [key]: activationId}};
}

export function switchTheme(state, themeId) {
    return {...state, themeId, activationId: state.activationId + 1};
}
