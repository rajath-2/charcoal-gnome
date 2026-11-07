import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Blur My Shell's popup pipeline inside `actor` (mirrors charcoal-launchers' appearance.js).
// Static: a blurred wallpaper copy; resolves to its group so the caller keeps it aligned.
export async function addBlur(actor, settings) {
    if (!settings.get_boolean('blur'))
        return null;
    const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
    const bms = ext?.stateObj;
    if (!bms?._effects_manager || !bms?._pipelines_manager)
        return null;
    let destroyed = false;
    const id = actor.connect('destroy', () => { destroyed = true; });
    try {
        if (settings.get_boolean('static-blur')) {
            const {Pipeline} = await import(`file://${ext.path}/pipelines/pipeline.js`);
            if (destroyed || !bms._effects_manager)
                return null;
            const group = new Meta.BackgroundGroup({name: 'charcoal-widgets-static-blur'});
            actor.add_child(group);
            const managers = [];
            const pipelines = Main.layoutManager.monitors.map(monitor => {
                const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, bms._settings.popup.PIPELINE, null);
                pipeline.create_background_with_effects(monitor.index, managers, group, 'charcoal-widgets-static-blur-monitor');
                return pipeline;
            });
            actor.connect('destroy', () => {
                // When Blur My Shell went first (disable, shutdown) it already released these.
                // Otherwise drop its own actor-destroy cleanup, which would touch released effects.
                if (bms._pipelines_manager)
                    pipelines.forEach(pipeline => pipeline.destroy());
                else
                    pipelines.forEach(pipeline => pipeline.disconnect_actor_destroy());
                managers.forEach(manager => manager.destroy());
            });
            return group;
        }
        const {DynamicPipeline} = await import(`file://${ext.path}/render/dynamic_surface.js`);
        if (destroyed || !bms._effects_manager)
            return null;
        const pipeline = new DynamicPipeline(bms._effects_manager, bms._pipelines_manager,
            bms._settings.popup.PIPELINE, {corner_radius: 0});
        pipeline.attach_to_container(actor, 'charcoal-widgets-backdrop');
        actor.connect('destroy', () => pipeline.destroy());
    } catch (error) {
        console.warn(`Charcoal Widgets: Blur My Shell backdrop unavailable: ${error.message}`);
    } finally {
        if (!destroyed)
            actor.disconnect(id);
    }
    return null;
}

const DECLARATIONS = `
uniform vec2 size;   // layer width, height
uniform vec4 box;    // the effect texture's x, y, width, height in layer pixels
uniform float radius;
`;
const CODE = `
vec2 p = box.xy + cogl_tex_coord_in[0].xy * box.zw;
vec2 half_size = size * 0.5;
vec2 q = p - half_size;
float r = min(radius, min(half_size.x, half_size.y));
vec2 e = abs(q) - half_size + r;
float dist = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
cogl_color_out *= clamp(0.5 - dist, 0.0, 1.0);
`;

// Cuts the blur layer to the card's rounded rectangle (charcoal-topbar's PanelMask, one shape).
export const RoundedMask = GObject.registerClass(class RoundedMask extends Clutter.ShaderEffect {
    setShape(size, box, radius) {
        this.set_uniform_float('size', 2, size);
        this.set_uniform_float('box', 4, box);
        this.set_uniform_float('radius', 1, [radius]);
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE);
    }
});
