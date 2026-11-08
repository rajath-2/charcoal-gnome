// Values a theme may own. Keys outside this catalog remain personal or functional settings.
const color = {type: 'color'};
const bool = {type: 'boolean'};
const integer = (min, max) => ({type: 'integer', min, max});
const text = {type: 'text'};
const json = {type: 'json'};
const number = (min, max) => ({type: 'number', min, max});
// Lock elements are placed by fractions of the monitor; decorative text-content stays personal.
const LOCK_ELEMENTS = ['clock', 'date', 'user', 'prompt', 'status', 'notifications', 'text', 'image'];

export const THEME_KEYS = {
    controls: {
        radius: integer(100, 320), 'neutral-radius': integer(20, 80),
        'text-size': integer(10, 32), 'background-color': color,
        'foreground-color': color, 'accent-color': color,
        'border-color': color, 'border-width': integer(0, 6),
        'shadow-color': color, 'shadow-size': integer(0, 60),
    },
    topbar: {
        mode: {type: 'choice', values: ['auto', 'compact', 'islands']},
        'invert-auto': bool, 'static-blur': bool,
        'bar-color': color, 'bar-opacity': integer(0, 100), 'islands-opacity': integer(0, 100),
        'border-opacity': integer(0, 60), 'text-color': color, 'accent-color': color,
        'bar-height': integer(22, 48), 'corner-radius': integer(0, 20),
        'top-margin': integer(0, 16), 'side-margin': integer(0, 400), 'island-margin': integer(0, 120),
        'bold-text': bool, shadow: bool, 'border-color': color, 'border-width': integer(0, 4),
        'shadow-color': color, 'shadow-size': integer(0, 40), 'shadow-opacity': integer(0, 100),
        'text-size': integer(70, 150), 'popup-text-color': color, 'popup-border-color': color,
        'popup-border-width': integer(0, 4), 'popup-border-opacity': integer(0, 60),
        'popup-shadow-color': color, 'popup-shadow-size': integer(0, 60),
        'popup-shadow-opacity': integer(0, 100), 'popup-color': color,
        'popup-opacity': integer(30, 100), 'popup-radius': integer(0, 32),
    },
    appearance: {
        'icon-theme': text, 'cursor-theme': text, 'cursor-size': integer(16, 96),
        'color-scheme': {type: 'choice', values: ['default', 'prefer-dark', 'prefer-light']},
        'button-layout': text,
    },
    launchers: {
        'wheel-radius': integer(100, 300), 'wheel-icon-size': integer(20, 64),
        'neutral-radius': integer(24, 80), 'ring-width': integer(40, 120),
        'wheel-opacity': integer(40, 100), 'wheel-open-duration': integer(0, 500),
        'wheel-close-duration': integer(0, 400), 'search-max-height': integer(30, 90),
        'sector-gap': integer(0, 12), 'background-color': color, 'foreground-color': color,
        'accent-color': color, 'wheel-background-color': color, 'wheel-foreground-color': color,
        'wheel-accent-color': color, 'border-color': color, 'border-width': integer(0, 4),
        'border-opacity': integer(0, 100), 'shadow-color': color, 'shadow-size': integer(0, 60),
        'shadow-opacity': integer(0, 100), 'wheel-border-color': color,
        'wheel-border-width': integer(0, 4), 'wheel-border-opacity': integer(0, 100),
        'wheel-shadow-color': color, 'wheel-shadow-size': integer(0, 60),
        'wheel-shadow-opacity': integer(0, 100), 'text-size': integer(70, 150),
        'background-opacity': integer(40, 100), 'corner-radius': integer(0, 40),
        'launcher-width': integer(360, 1000), 'search-icon-size': integer(20, 64),
        animations: bool, 'scale-animation': bool, 'open-duration': integer(0, 500),
        'close-duration': integer(0, 400), blur: bool, 'static-blur': bool,
        'wheel-blur': bool, 'blur-radius': integer(0, 60),
    },
    widgets: {
        'weather-size': integer(70, 150), 'calendar-size': integer(70, 150),
        'music-size': integer(70, 150), positions: json, sizes: json,
        'background-color': color, 'background-opacity': integer(0, 100),
        'border-color': color, 'border-width': integer(0, 6),
        'border-opacity': integer(0, 100), 'shadow-color': color,
        'shadow-size': integer(0, 60), 'shadow-opacity': integer(0, 100),
        'corner-radius': integer(0, 40), 'accent-color': color, 'text-color': color,
        blur: bool, 'static-blur': bool,
    },
    lockscreen: {
        ...Object.fromEntries(LOCK_ELEMENTS.flatMap(name => [
            [`${name}-x`, number(0, 1)], [`${name}-y`, number(0, 1)],
            [`${name}-w`, number(0.02, 1)], [`${name}-h`, number(0.02, 1)],
            ...(name === 'prompt' ? [] : [[`${name}-visible`, bool]]),
        ])),
        'image-uri': text, 'lock-wallpaper': text, 'element-styles': json,
        'font-family': text, 'font-weight': integer(100, 900), 'font-size': integer(8, 200),
        'text-color': color, 'accent-color': color, 'panel-color': color,
        'border-width': integer(0, 16), 'border-radius': integer(0, 64),
        'shadow-size': integer(0, 64), spacing: integer(0, 64),
    },
};

export function schemaFor(component) {
    return `org.gnome.shell.extensions.charcoal-${component}`;
}
