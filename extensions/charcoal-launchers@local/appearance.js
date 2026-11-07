import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

export function color(settings, key) {
    const value = settings.get_string(key);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080';
}
export function rgb(hex) {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
export function surfaceStyle(settings) {
    const [r, g, b] = rgb(color(settings, 'background-color')).map(v => Math.round(v * 255));
    return `background-color: rgba(${r},${g},${b},${settings.get_int('background-opacity') / 100});
        color: ${color(settings, 'foreground-color')}; border-radius: ${settings.get_int('corner-radius')}px;
        border: 1px solid rgba(255,255,255,0.12);`;
}
export function animate(actor, settings, opening, done = () => {}) {
    actor.remove_all_transitions();
    const duration = settings.get_boolean('animations') && St.Settings.get().enable_animations
        ? settings.get_int(opening ? 'open-duration' : 'close-duration') : 0;
    const scale = settings.get_boolean('scale-animation') ? (opening ? 0.94 : 0.96) : 1;
    actor.set_pivot_point(0.5, 0.5);
    if (opening) {
        actor.opacity = duration ? 0 : 255;
        actor.set_scale(duration ? scale : 1, duration ? scale : 1);
    }
    if (!duration) {
        actor.opacity = opening ? 255 : 0;
        actor.set_scale(1, 1);
        done();
        return;
    }
    actor.ease({opacity: opening ? 255 : 0, scale_x: opening ? 1 : scale,
        scale_y: opening ? 1 : scale, duration,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC, onComplete: done});
}
export function addBlur(actor, settings) {
    if (!settings.get_boolean('blur')) return;
    try {
        actor.add_effect_with_name('charcoal-blur', new Shell.BlurEffect({
            mode: Shell.BlurMode.BACKGROUND, radius: settings.get_int('blur-radius'), brightness: 0.8,
        }));
    } catch (error) {
        console.warn(`Charcoal Launchers: blur unavailable: ${error.message}`);
    }
}
