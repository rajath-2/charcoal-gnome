import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Hide the existing dock surface without changing the user's extension list or
// permanent dock preferences. Restore its visibility when this mode ends.
export class DockIntegration {
    constructor(settings) { this.settings = settings; this.saved = []; this.generation = 0; }
    async update() {
        this.restore();
        const generation = this.generation;
        if (!this.settings.get_boolean('wheel-enabled') || !this.settings.get_boolean('dock-mode') ||
            this.settings.get_boolean('desktop-dock')) return;
        const ext = Main.extensionManager.lookup('dash-to-dock@micxgx.gmail.com');
        let actors = [];
        if (ext?.state === 1) {
            try {
                const {DockManager} = await import(`file://${ext.path}/docking.js`);
                if (generation !== this.generation) return;
                actors = DockManager.allDocks ?? [];
            } catch (error) { console.warn(`Charcoal Launchers: dock integration: ${error.message}`); }
        } else if (Main.overview.dash) actors = [Main.overview.dash];
        for (const actor of actors) {
            const record = {actor, visible: actor.visible, visibility: 0, destroy: 0};
            record.visibility = actor.connect('notify::visible', () => { if (actor.visible) actor.hide(); });
            record.destroy = actor.connect('destroy', () => { this.saved = this.saved.filter(r => r !== record); });
            this.saved.push(record); actor.hide();
        }
    }
    restore() {
        this.generation++;
        for (const r of this.saved) {
            r.actor.disconnect(r.visibility); r.actor.disconnect(r.destroy);
            r.actor.visible = r.visible;
        }
        this.saved = [];
    }
    destroy() { this.restore(); }
}
