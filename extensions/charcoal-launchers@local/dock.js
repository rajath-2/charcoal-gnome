import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'dash-to-dock@micxgx.gmail.com';
// dash-to-dock values for "show only on hover": no intellihide, pointer at the edge reveals it.
const HOVER = {'dock-fixed': false, 'autohide': true, 'intellihide': false};

function dockSettings() {
    const ext = Main.extensionManager.lookup(UUID);
    if (!ext) return null;
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(`${ext.path}/schemas`,
            Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup('org.gnome.shell.extensions.dash-to-dock', true);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    } catch { return null; }
}

// Hide the existing dock surface without changing the user's extension list or
// permanent dock preferences (hover-only mode borrows three, journaled and handed back).
// Restore its visibility when this mode ends.
export class DockIntegration {
    constructor(settings) { this.settings = settings; this.saved = []; this.generation = 0; }
    async update() {
        this.restore();
        const generation = this.generation;
        const s = this.settings;
        this._hover(s.get_boolean('wheel-enabled') && s.get_boolean('dock-mode') && s.get_boolean('desktop-dock') &&
            s.get_boolean('desktop-dock-hover') && Main.extensionManager.lookup(UUID)?.state === 1);
        if (!this.settings.get_boolean('wheel-enabled') || !this.settings.get_boolean('dock-mode') ||
            this.settings.get_boolean('desktop-dock')) return;
        const ext = Main.extensionManager.lookup(UUID);
        let actors = [];
        if (ext?.state === 1) {
            try {
                const {DockManager} = await import(`file://${ext.path}/docking.js`);
                if (generation !== this.generation) return;
                actors = DockManager.allDocks ?? [];
            } catch (error) { console.warn(`Charcoal Launchers: dock integration: ${error.message}`); }
        } else if (Main.overview.dash) actors = [Main.overview.dash];
        for (const actor of actors) {
            const record = {actor, visible: actor.visible, visibility: 0, destroy: 0, activateApp: actor.activateApp};
            // Super+N still reaches the hidden dock; the wheel launches instead (input.js).
            if (record.activateApp) actor.activateApp = () => {};
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
            if (r.activateApp) delete r.actor.activateApp;
        }
        this.saved = [];
    }
    // Journaled in owned-dock first, so a crashed Shell still hands the user's values back next time.
    _hover(want) {
        let saved = null;
        try { saved = JSON.parse(this.settings.get_string('owned-dock') || 'null'); } catch {}
        if (Boolean(want) === Boolean(saved)) return;
        const dock = dockSettings();
        if (!dock) return;
        if (want) {
            saved = Object.fromEntries(Object.keys(HOVER).map(key => [key, dock.get_boolean(key)]));
            this.settings.set_string('owned-dock', JSON.stringify(saved));
            for (const [key, value] of Object.entries(HOVER)) dock.set_boolean(key, value);
        } else {
            // Keep anything the user changed in dash-to-dock meanwhile.
            for (const [key, value] of Object.entries(saved))
                if (dock.get_boolean(key) === HOVER[key]) dock.set_boolean(key, value);
            this.settings.set_string('owned-dock', '');
        }
    }
    destroy() { this.restore(); this._hover(false); }
}
