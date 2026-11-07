import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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
    const scale = settings.get_boolean('scale-animation') ? (opening ? 0.78 : 0.92) : 1;
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
// origin: the actor's stage position, so the static wallpaper copy lines up with what is behind it.
export async function addBlur(actor, settings, key = 'blur', origin = [0, 0]) {
    if (!settings.get_boolean(key)) return;
    const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
    const bms = ext?.stateObj;
    if (!bms?._effects_manager || !bms?._pipelines_manager) return;
    let destroyed = false;
    const id = actor.connect('destroy', () => { destroyed = true; });
    try {
        if (settings.get_boolean('static-blur')) {
            addStaticBlur(actor, bms, await import(`file://${ext.path}/pipelines/pipeline.js`), () => destroyed, origin);
            return;
        }
        const {DynamicPipeline} = await import(`file://${ext.path}/render/dynamic_surface.js`);
        if (destroyed || !bms._effects_manager) return;
        const pipeline = new DynamicPipeline(bms._effects_manager, bms._pipelines_manager,
            bms._settings.popup.PIPELINE, {corner_radius: 0});
        pipeline.attach_to_container(actor, 'charcoal-search-backdrop');
        actor.connect('destroy', () => pipeline.destroy());
    } catch (error) {
        console.warn(`Charcoal Launchers: Blur My Shell backdrop unavailable: ${error.message}`);
    } finally {
        if (!destroyed) actor.disconnect(id);
    }
}
// Blurred wallpaper copy per monitor: no per-frame capture of the windows behind (cheap).
function addStaticBlur(actor, bms, {Pipeline}, destroyed, [x, y]) {
    if (destroyed() || !bms._effects_manager) return;
    const group = new Meta.BackgroundGroup({name: 'charcoal-static-blur', x: -x, y: -y});
    actor.add_child(group);
    const managers = [];
    const pipelines = Main.layoutManager.monitors.map(monitor => {
        const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, bms._settings.popup.PIPELINE, null);
        pipeline.create_background_with_effects(monitor.index, managers, group, 'charcoal-search-static-blur-monitor');
        return pipeline;
    });
    actor.connect('destroy', () => {
        // When Blur My Shell went first (disable, shutdown) it already released these.
        if (bms._pipelines_manager) pipelines.forEach(pipeline => pipeline.destroy());
        managers.forEach(manager => manager.destroy());
    });
}
