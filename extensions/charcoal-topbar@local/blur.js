import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Blur My Shell's panel pipeline inside `actor` (mirrors charcoal-launchers' appearance.js).
// Static: a blurred wallpaper copy; resolves to its group so the caller can keep it aligned.
export async function addBlur(actor, staticBlur) {
    const ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
    const bms = ext?.stateObj;
    if (!bms?._effects_manager || !bms?._pipelines_manager)
        return null;
    let destroyed = false;
    const id = actor.connect('destroy', () => { destroyed = true; });
    try {
        if (staticBlur) {
            const {Pipeline} = await import(`file://${ext.path}/pipelines/pipeline.js`);
            if (destroyed || !bms._effects_manager)
                return null;
            const group = new Meta.BackgroundGroup({name: 'charcoal-topbar-static-blur'});
            actor.add_child(group);
            const managers = [];
            const pipelines = Main.layoutManager.monitors.map(monitor => {
                const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, bms._settings.panel.PIPELINE, null);
                pipeline.create_background_with_effects(monitor.index, managers, group, 'charcoal-topbar-static-blur-monitor');
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
            bms._settings.panel.PIPELINE, {corner_radius: 0});
        pipeline.attach_to_container(actor, 'charcoal-topbar-backdrop');
        actor.connect('destroy', () => pipeline.destroy());
    } catch (error) {
        console.warn(`Charcoal Topbar: Blur My Shell backdrop unavailable: ${error.message}`);
    } finally {
        if (!destroyed)
            actor.disconnect(id);
    }
    return null;
}
